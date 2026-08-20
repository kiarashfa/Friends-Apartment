/** WebGPU apartment runtime: shared renderer and image pipeline at startup,
 * apartment-owned worlds imported, built, compiled and cached only after the
 * corresponding hallway door is chosen. */
import './core/shadows'
import * as THREE from 'three/webgpu'
import { mix, mrt, normalView, output, pass, renderOutput, vec4 } from 'three/tsl'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import { loadApartmentDefinition } from './scenes'
import type { ApartmentDefinition, ApartmentId } from './scenes/types'
import { World } from './core/world'
import { PlayerControls } from './player/controls'
import type { SeatingSystem } from './player/seats'
import { Ui } from './ui/ui'
import { Music } from './audio/music'
import { blenderFilmicVeryHighContrast } from './core/filmic'
import { isDesktopChromium } from './core/platform'
import {
  installRendererFailureHandlers,
  type RendererFailure,
} from './core/rendererFailure'

interface GpuProbe {
  requestAdapter():Promise<{limits:{maxSampledTexturesPerShaderStage:number;maxSamplersPerShaderStage:number}}|null>
}

interface BuiltApartment {
  definition:ApartmentDefinition
  world:World
  meshes:THREE.Mesh[]
}

const nextFrame=():Promise<void>=>new Promise((resolve)=>requestAnimationFrame(()=>resolve()))

let bootStage='module'
let fatalShown=false
let stopActiveRendering:()=>void=()=>undefined

const describeFailure=(error:unknown):string=>error instanceof Error?`${error.name}: ${error.message}`:String(error)

function showFatalError(title:string,error:unknown):void{
  if(fatalShown)return
  fatalShown=true
  stopActiveRendering()
  const width=Math.max(1,innerWidth)
  const height=Math.max(1,innerHeight)
  const platform=(navigator as Navigator&{userAgentData?:{platform?:string}}).userAgentData?.platform
    ??navigator.platform
    ??'unknown platform'
  const detail=describeFailure(error)
  console.error(`[${bootStage}] ${title}: ${detail}`,error)
  Ui.fatal(`${title} · Stage ${bootStage} · ${detail} · ${width}×${height} CSS px · DPR ${devicePixelRatio.toFixed(2)} · ${platform}`)
}

function recommendedPixelRatio(width:number,height:number):number{
  const dpr=Math.min(devicePixelRatio,1.7,Math.sqrt(4_000_000/Math.max(1,width*height)))
  return Number.isFinite(dpr)&&dpr>0?dpr:1
}

function commitRendererSize(renderer:THREE.WebGPURenderer,width:number,height:number):void{
  renderer.setDrawingBufferSize(width,height,recommendedPixelRatio(width,height))
  renderer.domElement.style.width=`${width}px`
  renderer.domElement.style.height=`${height}px`
}

async function boot():Promise<void> {
  bootStage='platform-gate'
  if(!isDesktopChromium(navigator)){Ui.fatal('Desktop Chromium required');return}
  if(!('gpu' in navigator)){Ui.fatal('WebGPU required');return}
  let requestEntry:(id:ApartmentId)=>void=()=>undefined
  let requestResume:()=>void=()=>undefined
  // Scene-scoped: silent on the landing, begins from the top on scene entry,
  // pauses with Esc, resets when the player walks back out to the hallway.
  const music=new Music()
  const ui=new Ui({
    onEnter:(id)=>requestEntry(id),
    onResume:()=>requestResume(),
    music,
  })

  bootStage='adapter-limits'
  let requiredLimits:Record<string,number>={}
  try{
    const adapter=await (navigator as unknown as {gpu:GpuProbe}).gpu.requestAdapter()
    if(adapter)requiredLimits={
      maxSampledTexturesPerShaderStage:Math.min(32,adapter.limits.maxSampledTexturesPerShaderStage),
      maxSamplersPerShaderStage:Math.min(32,adapter.limits.maxSamplersPerShaderStage),
    }
  }catch{requiredLimits={}}

  bootStage='renderer-init'
  const renderer=new THREE.WebGPURenderer({
    // The scene MRT owns 4x MSAA. Multisampling the final fullscreen canvas
    // adds another resolve without improving geometry edges.
    antialias:false,
    requiredLimits,
  } as ConstructorParameters<typeof THREE.WebGPURenderer>[0])
  const handleRendererFailure=(failure:RendererFailure):void=>{
    showFatalError(
      failure.kind==='device-lost'?'Graphics device lost':'Graphics error',
      new Error(`${failure.type}: ${failure.message}`),
    )
  }
  const attachUncapturedErrorHandler=installRendererFailureHandlers(renderer,handleRendererFailure)
  try{
    await renderer.init()
    attachUncapturedErrorHandler()
  }catch(error){showFatalError('WebGPU initialization failed',error);return}
  if(fatalShown)return
  renderer.toneMapping=THREE.NoToneMapping
  renderer.toneMappingExposure=1
  renderer.shadowMap.enabled=true
  renderer.shadowMap.type=THREE.PCFShadowMap
  THREE.Cache.enabled=true
  document.body.appendChild(renderer.domElement)

  const initialWidth=Math.max(1,innerWidth)
  const initialHeight=Math.max(1,innerHeight)
  commitRendererSize(renderer,initialWidth,initialHeight)

  const camera=new THREE.PerspectiveCamera(66,initialWidth/initialHeight,0.02,300)
  camera.up.set(0,0,1)
  let controls:PlayerControls|null=null
  let seats:SeatingSystem|null=null
  let active:BuiltApartment|null=null
  let entryTarget:ApartmentId|null=null
  let entryReady=false
  let entering=false
  let started=false
  let toHallway=false
  let rendering=false
  const requestPointerLock=():void=>{
    try{void renderer.domElement.requestPointerLock().catch(()=>undefined)}catch{/* Unsupported options/permissions stay on the landing. */}
  }
  requestResume=()=>{
    if(!active)return
    music.arm()
    requestPointerLock()
  }

  // The pass graph is apartment-agnostic and can be created over an empty
  // scene. Only PassNode.scene changes after an apartment cache entry exists.
  const emptyScene=new THREE.Scene()
  const postProcessing=new THREE.PostProcessing(renderer)
  // Preserve the exact authored scene anti-aliasing after disabling redundant
  // MSAA on the final presentation canvas.
  const scenePass=pass(emptyScene,camera,{samples:4})
  scenePass.setMRT(mrt({output,normal:normalView}))
  const scenePassColor=scenePass.getTextureNode('output')
  const scenePassNormal=scenePass.getTextureNode('normal')
  const scenePassDepth=scenePass.getTextureNode('depth')
  const gtaoPass=ao(scenePassDepth,scenePassNormal,camera)
  gtaoPass.resolutionScale=1;gtaoPass.radius.value=0.32;gtaoPass.thickness.value=1.25
  gtaoPass.distanceExponent.value=1.5;gtaoPass.distanceFallOff.value=0.82
  gtaoPass.scale.value=0.9;gtaoPass.samples.value=12
  const litColor:THREE.Node=scenePassColor.mul(mix(1,gtaoPass.getTextureNode().r,0.34))
  const bloomPass=bloom(scenePassColor,0.07,0.5,1)
  const hdrOutput=litColor.add(bloomPass)
  const displayLinear=blenderFilmicVeryHighContrast(hdrOutput.rgb)
  postProcessing.outputColorTransform=false
  postProcessing.outputNode=renderOutput(vec4(displayLinear,hdrOutput.a),THREE.NoToneMapping,renderer.outputColorSpace)

  // Prime render targets and apartment-independent post shaders after the DOM
  // landing has painted. A selected apartment may download concurrently, but
  // its geometry/material compilation waits for this shared work to finish.
  const sharedPipelineReady=(async()=>{
    await nextFrame()
    bootStage='shared-pipeline-warmup'
    scenePass.scene=emptyScene
    postProcessing.render()
    await nextFrame()
  })

  const clock=new THREE.Clock(false)
  let cancelEntryFrame:(()=>void)|null=null
  const stopRendering=():void=>{
    if(rendering){renderer.setAnimationLoop(null);clock.stop();rendering=false}
    const cancel=cancelEntryFrame
    cancelEntryFrame=null
    cancel?.()
  }
  stopActiveRendering=stopRendering
  // Every apartment is a still life - no time-driven node, animated texture or
  // runtime shadow update - so a frame can only differ when the camera pose
  // changed (walking, look, bob, seat choreography, seated breathing) or an
  // invalidation (resize, activation) demands one. The loop keeps simulating
  // every tick but presents nothing while the image would be identical.
  let needsRender=true
  const renderedPosition=new THREE.Vector3()
  const renderedQuaternion=new THREE.Quaternion()
  const POSE_EPS_POS=1e-10 // squared metres: 0.01 mm, far under a visible parallax step
  const POSE_EPS_ROT=1e-10 // 1-|q dot|: ~3e-5 rad, far under a pixel of pan
  const renderFrame=():void=>{
    const dt=clock.getDelta()
    if(controls?.enabled)controls.update(dt)
    seats?.update(dt)
    const moved=camera.position.distanceToSquared(renderedPosition)>POSE_EPS_POS
      ||1-Math.abs(camera.quaternion.dot(renderedQuaternion))>POSE_EPS_ROT
    if(!needsRender&&!moved)return
    needsRender=false
    renderedPosition.copy(camera.position)
    renderedQuaternion.copy(camera.quaternion)
    postProcessing.render()
  }
  const startRendering=():void=>{if(rendering)return;rendering=true;needsRender=true;clock.start();renderer.setAnimationLoop(renderFrame)}
  const startEntryRendering=():Promise<boolean>=>{
    if(rendering)return Promise.resolve(true)
    rendering=true
    needsRender=true
    clock.start()
    return new Promise((resolve,reject)=>{
      let pending=true
      cancelEntryFrame=()=>{
        if(!pending)return
        pending=false
        resolve(false)
      }
      renderer.setAnimationLoop(()=>{
        if(!pending)return
        try{renderFrame()}
        catch(error){
          pending=false
          cancelEntryFrame=null
          renderer.setAnimationLoop(null)
          clock.stop()
          rendering=false
          reject(error)
          return
        }
        pending=false
        cancelEntryFrame=null
        renderer.setAnimationLoop(renderFrame)
        resolve(true)
      })
    })
  }

  const poseForBuild=(definition:ApartmentDefinition):void=>{
    const [x,y]=definition.spawn.position
    const [lookX,lookY]=definition.spawn.lookAt
    camera.position.set(x,y,1.62)
    camera.up.set(0,0,1)
    camera.lookAt(lookX,lookY,1.58)
    camera.updateProjectionMatrix()
  }

  async function compileApartment(apartment:BuiltApartment):Promise<void>{
    const {world,meshes,definition}=apartment
    poseForBuild(definition)
    const previousScene=scenePass.scene
    const visible=meshes.map((mesh)=>mesh.visible)
    scenePass.scene=world.scene
    renderer.setRenderTarget(scenePass.renderTarget)
    try{
      const chunkSize=12
      for(let start=0;start<meshes.length;start+=chunkSize){
        meshes.forEach((mesh,index)=>{mesh.visible=visible[index]&&index>=start&&index<start+chunkSize})
        await renderer.compileAsync(world.scene,camera)
        await nextFrame()
      }
    }finally{
      meshes.forEach((mesh,index)=>{mesh.visible=visible[index]})
      renderer.setRenderTarget(null)
      scenePass.scene=previousScene
    }
  }

  async function warmApartment(apartment:BuiltApartment):Promise<void>{
    if(!renderer.shadowMap.enabled)return
    const previousScene=scenePass.scene
    scenePass.scene=apartment.world.scene
    try{
      // Freeze every map before the first warm-up pass: a light still on
      // autoUpdate re-renders its map during every earlier light's pass.
      for(const light of apartment.world.lights)if(light.castShadow&&light.shadow)light.shadow.autoUpdate=false
      for(const light of apartment.world.lights){
        if(!light.castShadow||!light.shadow)continue
        light.shadow.needsUpdate=true
        postProcessing.render()
        await nextFrame()
      }
      // One settled full-scene frame primes the shared AO/bloom/presentation
      // passes after the apartment-specific material and shadow compilation.
      postProcessing.render()
      await nextFrame()
    }finally{scenePass.scene=previousScene}
  }

  const built=new Map<ApartmentId,BuiltApartment>()
  const pending=new Map<ApartmentId,Promise<BuiltApartment>>()
  const getApartment=(id:ApartmentId):Promise<BuiltApartment>=>{
    const cached=built.get(id)
    if(cached)return Promise.resolve(cached)
    const existing=pending.get(id)
    if(existing)return existing
    const request=(async()=>{
      bootStage=`scene:${id}:definition`
      const definitionRequest=loadApartmentDefinition(id)
      const [definition]=await Promise.all([definitionRequest,sharedPipelineReady])
      await nextFrame()
      bootStage=`scene:${id}:build`
      const world=new World()
      await definition.build(world)
      const meshes:THREE.Mesh[]=[]
      world.scene.traverse((object)=>{if((object as THREE.Mesh).isMesh)meshes.push(object as THREE.Mesh)})
      const apartment={definition,world,meshes}
      bootStage=`scene:${id}:compile`
      await compileApartment(apartment)
      bootStage=`scene:${id}:shadow-warmup`
      await warmApartment(apartment)
      built.set(id,apartment)
      return apartment
    })().catch((error)=>{
      pending.delete(id)
      throw error
    })
    pending.set(id,request)
    void request.then(()=>pending.delete(id))
    return request
  }

  const activateApartment=async(apartment:BuiltApartment):Promise<void>=>{
    apartment.definition.activate?.(apartment.world.scene)
    scenePass.scene=apartment.world.scene
    if(!controls)controls=new PlayerControls(camera,apartment.world.colliders)
    else controls.setColliders(apartment.world.colliders)
    controls.setGround(apartment.definition.groundHeight?.bind(apartment.definition))
    controls.spawn(...apartment.definition.spawn.position,...apartment.definition.spawn.lookAt)
    const authored=apartment.definition.interactions.seats.length>0||(apartment.definition.interactions.couches?.length??0)>0
    const interactions=authored?apartment.definition.interactions:undefined
    if(!seats){
      const {SeatingSystem:Seats}=await import('./player/seats')
      seats=new Seats(controls,camera,()=>{toHallway=true;document.exitPointerLock()},interactions)
    }else seats.configure(interactions)
    active=apartment
    controls.enabled=document.pointerLockElement===renderer.domElement
    needsRender=true
  }

  const tryEnter=():void=>{
    if(entering||!entryReady||!entryTarget||active?.definition.id!==entryTarget)return
    if(document.pointerLockElement!==renderer.domElement)return
    entering=true
    const target=entryTarget
    void startEntryRendering().then((rendered)=>{
      entering=false
      if(!rendered||fatalShown||entryTarget!==target||active?.definition.id!==target
        ||document.pointerLockElement!==renderer.domElement){
        if(!started)stopRendering()
        return
      }
      entryReady=false
      entryTarget=null
      started=true
      bootStage=`scene:${target}:running`
      // The first live animation-loop frame is already submitted behind the
      // loading veil, so opening it cannot expose first-frame work or a blank.
      ui.enterGame()
      music.begin()
    }).catch((error)=>{
      entering=false
      showFatalError('Rendering failed',error)
    })
  }

  requestEntry=(id)=>{
    // Both Web Audio and pointer lock must consume the door click's transient
    // activation synchronously. Arming is silent; playback starts only after
    // a rendered scene frame and a successful pointer-lock handshake.
    music.arm()
    if(entryReady&&entryTarget===id&&active?.definition.id===id){
      requestPointerLock()
      tryEnter()
      return
    }
    entryTarget=id
    entryReady=false
    ui.beginLoading(id)
    requestPointerLock()
    void (async()=>{
      try{
        const apartment=await getApartment(id)
        if(fatalShown||entryTarget!==id)return
        bootStage=`scene:${id}:activate`
        await activateApartment(apartment)
        if(fatalShown||entryTarget!==id)return
        entryReady=true
        ui.finishLoading()
        tryEnter()
      }catch(error){
        if(entryTarget!==id)return
        entryTarget=null
        entryReady=false
        started=false
        stopRendering()
        ui.finishLoading()
        if(document.pointerLockElement===renderer.domElement)document.exitPointerLock()
        showFatalError('Scene unavailable',error)
      }
    })()
  }

  let resizeFrame:number|null=null
  window.addEventListener('resize',()=>{
    if(fatalShown||resizeFrame!==null)return
    resizeFrame=requestAnimationFrame(()=>{
      resizeFrame=null
      if(fatalShown)return
      const width=innerWidth
      const height=innerHeight
      if(width===0||height===0)return
      commitRendererSize(renderer,width,height)
      camera.aspect=width/height
      camera.updateProjectionMatrix()
      needsRender=true
    })
  })

  document.addEventListener('pointerlockchange',()=>{
    if(fatalShown)return
    const locked=document.pointerLockElement===renderer.domElement
    if(controls)controls.enabled=locked&&!!active
    if(locked){
      if(entryTarget)tryEnter()
      else if(started&&active){ui.enterGame();startRendering();music.resume()}
      return
    }
    if(entryTarget){
      if(entering)stopRendering()
      return
    }
    if(started){
      stopRendering()
      // Esc holds the loop where it stands; walking out resets it, so the
      // next scene starts the music over.
      if(toHallway){toHallway=false;bootStage='landing';ui.showHallway();music.reset()}
      else{ui.showPause();music.pause()}
    }
  })

  bootStage='shared-pipeline-warmup'
  await sharedPipelineReady
  if(fatalShown)return
  bootStage='landing'
  ui.ready()
}

void boot().catch((error)=>showFatalError('Loading failed',error))
