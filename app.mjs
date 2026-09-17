import {nextPose,jumpPose} from './poses.mjs';
import {GameEngine,DURATION,GRAVITY,JUMP_VELOCITY,TAU} from './engine.mjs';
import {VoiceGate} from './voice.mjs';
const $=id=>document.getElementById(id);
const canvas=$('scene'),ctx=canvas.getContext('2d'),video=$('camera');
const W=480,voiceGate=new VoiceGate();
// ?zones is the TikTok safe-zone build: ground at 68% so the jumper stays inside the core zone (y ≤ 533/694). The plain link keeps the ground at the bottom.
const ZONES=new URLSearchParams(location.search).has('zones');if(ZONES)document.documentElement.classList.add('zones');
let H=840,GROUND=ZONES?571:780;
// Safari changes its visible height while opening the camera / browser bars.
// Size the fixed mobile surface to that viewport, never to document content.
function syncViewport(){
 const viewport=window.visualViewport;
 const height=viewport?.height||window.innerHeight;
 const surface=$('voice-app');
 surface.style.setProperty('--game-viewport-height',`${height}px`);
 surface.style.setProperty('--game-viewport-top',`${viewport?.offsetTop||0}px`);
}
syncViewport();
window.addEventListener('resize',syncViewport);
window.visualViewport?.addEventListener('resize',syncViewport);
window.visualViewport?.addEventListener('scroll',syncViewport);
// The top layer escapes any host-page transform or centering container.
const surface=$('voice-app');
if(typeof surface.showPopover==='function'){surface.setAttribute('popover','manual');surface.showPopover();}
syncViewport();
window.addEventListener('pageshow',syncViewport);
new ResizeObserver(([entry])=>{
 const {width,height}=entry.contentRect;
 if(!width||!height)return;
 H=Math.round(W*height/width);GROUND=ZONES?Math.round(H*.68):H-60;canvas.height=H;
}).observe($('phone'));
let mode='idle',practice=false,face=null,landmarker=null,stream=null,muted=false,audioContext=null;
let ignoreMicUntil=0;
let countdownAge=0,lastCount='',animTime=0,fallAge=0,winAge=0,lastFrame=performance.now();
let lastVideoTime=-1,lastDetection=0,lastFaceAt=0,faceStableAt=0,setupStarted=0,cameraAttempt=0;
let paused=false,hiddenPause=false,loadingModel=null,roundTimer=0;
let artReady=false,court,body,particles=[],detectionErrors=0;
// Three outfits on one template: same neck, slightly different rope-handle spots (avatar space, 290 px body).
const BODIES=[{src:'./assets/body-1.png',hx:86,hy:-178,hair:'braids'},{src:'./assets/body-2.png',hx:77,hy:-177,hair:'pony'},{src:'./assets/body-3.png',hx:89,hy:-186}];let bodyIdx=0;
// Hair: a static cap behind the face plus swinging parts, each pivoting where it leaves the head. Coordinates are in the 1254-px source frame; HAIR_S maps that onto the 142-px face.
const HAIR_S=.36,HAIR_CX=627,HAIR_CY=330,HAIR_HEAD_Y=-46;
const HAIR={braids:{cap:'./assets/hair/braids-cap.png',parts:[{src:'./assets/hair/braid-left.png',px:425,py:370,dir:1,rest:-.22},{src:'./assets/hair/braid-right.png',px:830,py:370,dir:-1,rest:-.22}]},
            pony:{cap:'./assets/hair/pony-cap.png',parts:[{src:'./assets/hair/pony-tail.png',px:600,py:110,dir:-.8}]}};
let hairSwing=0,hairVel=0,prevHeight=0;
function hairImages(){const out=[];for(const h of Object.values(HAIR)){out.push(h);out.push(...h.parts)}return out}
function drawHair(){
 const h=HAIR[BODIES[bodyIdx].hair];if(!h||!h.img)return;
 const size=1254*HAIR_S,ox=-HAIR_CX*HAIR_S,oy=HAIR_HEAD_Y-HAIR_CY*HAIR_S;
 for(const part of h.parts){if(!part.img)continue;const px=ox+part.px*HAIR_S,py=oy+part.py*HAIR_S;ctx.save();ctx.translate(px,py);ctx.rotate(Math.max(-.6,Math.min(.32,hairSwing+(part.rest||0)))*part.dir);ctx.drawImage(part.img,ox-px,oy-py,size,size);ctx.restore()}
 ctx.drawImage(h.img,ox,oy,size,size);
}
function pickBody(){if(!BODIES[0].img)return;let i=Math.floor(Math.random()*BODIES.length);if(BODIES.length>1&&i===bodyIdx)i=(i+1)%BODIES.length;bodyIdx=i;body=BODIES[i].img}
let analyser=null,micSource=null,micSink=null,micSamples=null,noiseLevels=[],micStarted=0,micCalibrated=false;
const stateEngine=new GameEngine(onGameEvent);
let poseKind=0,currentPose=null;
const emptySchema={type:'object',properties:{},additionalProperties:false};
function show(id,yes=true){$(id).hidden=!yes}
function setMode(next){mode=next;show('cameraTile',!!stream);$('phone').className='phone '+next;show('startPanel',next==='idle');show('setupPanel',next==='setup');show('micCheck',next==='miccheck');show('hud',['countdown','playing','falling','result','win'].includes(next));show('playControls',practice&&next==='playing');show('resultPanel',next==='result');show('countdown',next==='countdown');}
function sound(type){
 if(muted||!audioContext||(!practice&&!['jump','land','fall','bounce','win'].includes(type)))return;if(!practice&&['jump','land'].includes(type)){ignoreMicUntil=performance.now()+170;voiceGate.reset();}
 const ac=audioContext,t=ac.currentTime;
 const notes={jump:[[430,810,.085]],land:[[145,65,.075]],clear:[[720,900,.07]],count:[[540,540,.10]],go:[[660,1100,.2]],snap:[[1900,100,.055]],fall:[[420,80,.48],[120,45,.23,.52]],bounce:[[150,65,.13]],win:[[523,523,.12],[659,659,.12,.13],[784,784,.12,.26],[1047,1047,.4,.4]]}[type]||[];
 for(const [a,b,d,offset=0] of notes){const osc=ac.createOscillator(),gain=ac.createGain();osc.type=type==='fall'?'sawtooth':'sine';osc.frequency.setValueAtTime(a,t+offset);osc.frequency.exponentialRampToValueAtTime(b,t+offset+d);gain.gain.setValueAtTime(.0001,t+offset);gain.gain.exponentialRampToValueAtTime(type==='jump'?.045:type==='land'?.055:type==='fall'?.055:.1,t+offset+.01);gain.gain.exponentialRampToValueAtTime(.0001,t+offset+d);osc.connect(gain).connect(ac.destination);osc.start(t+offset);osc.stop(t+offset+d+.025)}
}
function activateAudio(){try{if(!audioContext||audioContext.state==='closed')audioContext=new(window.AudioContext||window.webkitAudioContext)();void audioContext.resume().catch(()=>{});loadStingers()}catch{}}
// Result stingers shared with the salon game, so the whole set ends on the same note.
const STINGER_SRC={great:'./assets/audio/ending-great.mp3',bad:'./assets/audio/ending-bad.mp3'},stingerBuf={};
function loadStingers(){for(const [k,src] of Object.entries(STINGER_SRC)){if(stingerBuf[k])continue;stingerBuf[k]='loading';fetch(src).then(r=>r.arrayBuffer()).then(b=>audioContext.decodeAudioData(b)).then(buf=>{stingerBuf[k]=buf}).catch(()=>{delete stingerBuf[k]})}}
function stinger(k,gain=1,delay=0){const buf=stingerBuf[k];if(muted||!audioContext||!buf||buf==='loading')return false;const s=audioContext.createBufferSource();s.buffer=buf;const g=audioContext.createGain();g.gain.value=gain;s.connect(g).connect(audioContext.destination);s.start(audioContext.currentTime+delay);return true}
// Music bed: 126 bpm, four bars of F / C / Dm / Bb, kick + hats + clap + bass + plucks. Quiet on purpose: it sets a mood under the mic, not over it.
const BPM=126,STEP=60/BPM/4,BASS=[87.31,65.41,73.42,58.27],CHORDS=[[349.23,440,523.25],[329.63,392,523.25],[293.66,349.23,440],[293.66,349.23,466.16]];
const music={on:false,gain:null,next:0,step:0,timer:null,noise:null};
function noiseBuffer(ac){if(music.noise)return music.noise;const b=ac.createBuffer(1,ac.sampleRate,ac.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;music.noise=b;return b}
function musicStart(){if(music.on||muted||!audioContext||audioContext.state!=='running')return;const ac=audioContext;music.on=true;music.gain=ac.createGain();music.gain.gain.setValueAtTime(.0001,ac.currentTime);music.gain.gain.exponentialRampToValueAtTime(practice?.16:.09,ac.currentTime+1);music.gain.connect(ac.destination);music.next=ac.currentTime+.05;music.step=0;music.timer=setInterval(musicTick,80);musicTick()}
function musicStop(fade=.6){if(!music.on)return;music.on=false;clearInterval(music.timer);const g=music.gain,ac=audioContext;try{g.gain.cancelScheduledValues(ac.currentTime);g.gain.setValueAtTime(g.gain.value,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+fade)}catch{}setTimeout(()=>{try{g.disconnect()}catch{}},fade*1000+50)}
function musicTick(){const ac=audioContext;if(!music.on||!ac)return;while(music.next<ac.currentTime+.3){musicStep(music.step,music.next);music.step++;music.next+=STEP}}
function musicStep(i,t){
 const ac=audioContext,out=music.gain,s=i%16,bar=Math.floor(i/16)%4;
 const tone=(type,f0,f1,dur,vol,at=t)=>{const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(f0,at);if(f1!==f0)o.frequency.exponentialRampToValueAtTime(f1,at+dur*.6);g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(vol,at+.008);g.gain.exponentialRampToValueAtTime(.0001,at+dur);o.connect(g).connect(out);o.start(at);o.stop(at+dur+.02)};
 const hiss=(freq,q,dur,vol,type='highpass')=>{const src=ac.createBufferSource();src.buffer=noiseBuffer(ac);src.loop=true;const f=ac.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;const g=ac.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.004);g.gain.exponentialRampToValueAtTime(.0001,t+dur);src.connect(f).connect(g).connect(out);src.start(t);src.stop(t+dur+.02)};
 if(s%4===0)tone('sine',130,48,.16,.7);                       // soft kick
 hiss(7500,.7,s%4===2?.07:.035,s%4===2?.22:.12);              // hats, open on the off-beat
 if(s===4||s===12)hiss(1900,1.2,.11,.28,'bandpass');           // clap
 if([0,3,6,10,12,14].includes(s))tone('triangle',BASS[bar],BASS[bar],.2,.42);  // bouncy bass
 if([2,6,9,13].includes(s))for(const f of CHORDS[bar])tone('triangle',f,f,.16,.07); // plucked chord stabs
 if(s===8||s===15)tone('sine',CHORDS[bar][2]*2,CHORDS[bar][2]*2,.12,.05);      // sparkle
}
function onGameEvent(event){
 sound(event);
 if(event==='jump'){poseKind=nextPose(poseKind);for(let i=0;i<5;i++)particles.push({x:240+(Math.random()-.5)*60,y:GROUND,vx:(Math.random()-.5)*50,vy:-Math.random()*40,age:0,life:.4,color:'#fff9de',size:3});}
 if(event==='fall'){setMode('falling');fallAge=0;show('playControls',false);musicStop(.25);}
 if(event==='win'){setMode('win');winAge=0;for(let i=0;i<90;i++)particles.push({x:Math.random()*W,y:-Math.random()*H*.8,vx:(Math.random()-.5)*150,vy:100+Math.random()*140,age:0,life:8,color:['#ffe052','#ff716f','#9b88ff','#fffdf0','#4ec9b0'][i%5],size:3+Math.random()*4});}
}
function snapshot(){return{mode,control:practice?'space_or_tap':'voice',timeSurvived:Number(stateEngine.time.toFixed(2)),jumps:stateEngine.jumps,paused,faceCaptured:!!face}}
function launchCountdown(){
 clearTimeout(roundTimer);paused=false;hiddenPause=false;show('pauseLayer',false);stateEngine.reset();voiceGate.reset();countdownAge=0;lastCount='';particles=[];pickBody();setMode('countdown');$('time').innerHTML=DURATION.toFixed(1)+'<span>s</span>';$('score').textContent='0';
}
function launchNow(){launchCountdown();countdownAge=3;} // camera flow: the "ah" is the start button, straight to GO!
function jump(){if(mode!=='playing'||paused)return false;return stateEngine.jump()}
function finish(){const won=stateEngine.state==='won';setMode('result');$('resultPanel').classList.toggle('win',won);$('resultTitle').textContent=won?'Congrats':'You lose';musicStop(.4);stinger(won?'great':'bad',.9,.1);}
function stopCamera(){cameraAttempt++;micSource?.disconnect();analyser?.disconnect();micSink?.disconnect();micSink=null;micSource=null;analyser=null;micSamples=null;micCalibrated=false;noiseLevels=[];stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;show('cameraTile',false);lastVideoTime=-1;faceStableAt=0;}
async function startPractice(){activateAudio();stopCamera();practice=true;face=null;await assetsReady;launchCountdown()}
async function getModel(){if(landmarker)return landmarker;if(loadingModel)return loadingModel;loadingModel=(async()=>{const {FaceLandmarker,FilesetResolver}=await import('./vendor/vision_bundle.mjs');const fileset=await FilesetResolver.forVisionTasks('./vendor/wasm');const options={baseOptions:{modelAssetPath:'./vendor/face_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,minTrackingConfidence:.5};try{return await FaceLandmarker.createFromOptions(fileset,options)}catch{options.baseOptions.delegate='CPU';return await FaceLandmarker.createFromOptions(fileset,options)}})();try{landmarker=await loadingModel;return landmarker}finally{loadingModel=null}}
function cameraError(title,message){show('spinner',false);$('setupTitle').textContent=title;$('setupText').textContent=message;show('retryCamera');}
async function startCamera(){
 activateAudio();stopCamera();practice=false;face=null;setMode('setup');show('retryCamera',false);show('spinner');$('setupTitle').textContent='Camera + microphone';$('setupText').textContent='Look straight ahead. We’ll take the photo for you.';faceStableAt=0;lastDetection=0;detectionErrors=0;const attempt=++cameraAttempt;setupStarted=performance.now();
 try{
   if(!navigator.mediaDevices?.getUserMedia)throw Object.assign(new Error('Camera unavailable'),{name:'Unavailable'});
   const modelPromise=getModel();modelPromise.catch(()=>{});
   const incoming=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:true}});
   if(attempt!==cameraAttempt){incoming.getTracks().forEach(t=>t.stop());return}
   stream=incoming;
   if(!stream.getAudioTracks().length)throw new Error('Microphone unavailable');
   if(!audioContext||audioContext.state==='closed')activateAudio();
   void audioContext.resume().catch(()=>{});
   micSource=audioContext.createMediaStreamSource(stream);analyser=audioContext.createAnalyser();analyser.fftSize=2048;micSource.connect(analyser);
   micSink=audioContext.createGain();micSink.gain.value=0;analyser.connect(micSink);micSink.connect(audioContext.destination);micSamples=new Float32Array(analyser.fftSize);micStarted=performance.now();noiseLevels=[];micCalibrated=false;
   video.srcObject=new MediaStream(stream.getVideoTracks());await video.play();syncViewport();show('cameraTile');$('setupTitle').textContent='Getting your face ready…';
   await Promise.all([modelPromise,assetsReady]);if(attempt!==cameraAttempt)return;
   $('setupTitle').textContent='Look here & hold still';$('setupText').textContent='Hold still and stay quiet for a moment.';setupStarted=performance.now();
 }catch(error){if(attempt!==cameraAttempt)return;stopCamera();const permission=error.name==='NotAllowedError'||error.name==='PermissionDeniedError';cameraError(permission?'Camera or mic access is off':'Couldn’t start camera + mic',permission?'Allow camera and microphone access, then try again.':error.name==='NotFoundError'?'Camera or microphone not found. Try tap practice.':'Check your camera and microphone, then retry or try tap practice.');}
}
const oval=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
function captureFace(landmarks){
 const vw=video.videoWidth,vh=video.videoHeight,points=oval.map(i=>({x:landmarks[i].x*vw,y:landmarks[i].y*vh}));
 const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxX=Math.max(...points.map(p=>p.x)),maxY=Math.max(...points.map(p=>p.y));
 const crop=document.createElement('canvas');crop.width=400;crop.height=Math.round(400*(maxY-minY)/(maxX-minX));const c=crop.getContext('2d');const pad=12,sx=(crop.width-pad*2)/(maxX-minX),sy=(crop.height-pad*2)/(maxY-minY);
 c.translate(crop.width,0);c.scale(-1,1);c.beginPath();points.forEach((p,i)=>{const x=pad+(p.x-minX)*sx,y=pad+(p.y-minY)*sy;i?c.lineTo(x,y):c.moveTo(x,y)});c.closePath();c.strokeStyle='#fffdf2';c.lineWidth=16;c.lineJoin='round';c.stroke();c.save();c.clip();c.drawImage(video,minX,minY,maxX-minX,maxY-minY,pad,pad,crop.width-pad*2,crop.height-pad*2);c.restore();face=crop;
 $('captureFlash').classList.remove('flash');void $('captureFlash').offsetWidth;$('captureFlash').classList.add('flash');voiceGate.reset();setMode('miccheck');
}
function updateFace(now){
 if(!landmarker||!stream||video.readyState<2||practice||video.currentTime===lastVideoTime||now-lastDetection<32||document.hidden)return;
 if(mode!=='setup')return;
 lastVideoTime=video.currentTime;lastDetection=now;
 try{
 const result=landmarker.detectForVideo(video,now);detectionErrors=0;const landmarks=result.faceLandmarks?.[0];
 if(!landmarks){faceStableAt=0;if(mode==='setup'&&now-setupStarted>6000){$('setupTitle').textContent='Move your face into frame';$('setupText').textContent='Face the camera in good light. Your selfie is automatic.'}return}
 lastFaceAt=now;const blend=result.faceBlendshapes?.[0]?.categories||[];const left=blend.find(x=>x.categoryName==='eyeBlinkLeft')?.score??0,right=blend.find(x=>x.categoryName==='eyeBlinkRight')?.score??0;
 const isClosed=left>.46&&right>.46;
 if(mode==='setup'){
  const width=Math.abs(landmarks[454].x-landmarks[234].x);const centered=landmarks[1].x>.2&&landmarks[1].x<.8&&landmarks[10].y>.03&&landmarks[152].y<.97&&width>.16;
  if(centered&&!isClosed&&artReady&&micCalibrated){if(!faceStableAt)faceStableAt=now;const remain=Math.max(0,1.25-(now-faceStableAt)/1000);$('setupTitle').textContent=remain>.5?'Hold still…':'Say cheese!';if(remain===0)captureFace(landmarks)}else{faceStableAt=0;$('setupTitle').textContent='Center your face & open your eyes'}
 }
 }catch{detectionErrors++;if(detectionErrors>6){if(mode==='setup')cameraError('Face tracking needs a restart','Try again, or use tap practice.');else{}}}
}
function updateVoice(now){
 if(mode==='miccheck'){show('enableMic',audioContext?.state!=='running');}
 if(mode==='setup')show('setupMic',!!stream&&audioContext?.state!=='running');
 if(!analyser||!micSamples||practice||document.hidden||audioContext?.state!=='running')return;
 analyser.getFloatTimeDomainData(micSamples);
 let sum=0;for(const sample of micSamples)sum+=sample*sample;
 const level=Math.sqrt(sum/micSamples.length);
 if(!micCalibrated){
   noiseLevels.push(level);
   if(now-micStarted>=800){voiceGate.calibrate(noiseLevels);voiceGate.reset();micCalibrated=true;}
   return;
 }
 if(mode==='miccheck')$('micLevel').style.transform=`scaleX(${Math.min(1,level/voiceGate.threshold)})`;
 if(now<ignoreMicUntil)return;
 const onset=voiceGate.update(level,now);
 if(onset&&mode==='miccheck'){launchCountdown();return;}
 if(onset&&mode==='playing'&&!paused)jump();
}
function drawRope(phase,base,jumpY,fall=0){
 const hy=BODIES[bodyIdx].hy,hx=BODIES[bodyIdx].hx;const handY=base+hy-jumpY;const radius=-hy+jumpY;ctx.save();ctx.beginPath();
 for(let i=0;i<=70;i++){const u=i/70;const x=240-Math.cos(u*Math.PI)*hx;let y=handY+Math.cos(phase)*radius*Math.sin(u*Math.PI)-Math.sin(phase)*28*Math.sin(u*Math.PI);if(fall>0)y+=Math.sin(u*Math.PI*3)*Math.min(fall,1)*14; i?ctx.lineTo(x,y):ctx.moveTo(x,y)}
 ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#263c47';ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle=fall?'#ff777d':'#ee9cd2';ctx.lineWidth=4.8;ctx.stroke();ctx.strokeStyle='#ffd9f2';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
}
function drawAvatar(base,height,rotation=0,sx=1,sy=1,offsetX=0){
 ctx.save();ctx.translate(240+offsetX,base-height);ctx.rotate(rotation);ctx.scale(sx,sy);
 // The body is a sprite; its neck, hand and foot anchors share this transform.
 if(currentPose?.legs){
  // Articulate the existing sprite at the hips, retaining its original texture.
  const split=177,sourceY=body.height*split/290;
  ctx.drawImage(body,0,0,body.width,sourceY,-145,-282,290,split);
  for(const side of [-1,1]){
   const pivot=side*36;
   ctx.save();ctx.translate(pivot,-105);ctx.rotate(-side*currentPose.legs);
   ctx.drawImage(body,side<0?0:body.width/2,sourceY,body.width/2,body.height-sourceY,(side<0?-145:0)-pivot,0,145,113);
   ctx.restore();
  }
 }else ctx.drawImage(body,-145,-282,290,290);
 ctx.save();ctx.translate(0,-290);ctx.rotate(Math.sin(animTime*3)*.028+(currentPose?.head||0));drawHair();
 if(face){const fh=142,fw=Math.min(143,fh*face.width/face.height);ctx.drawImage(face,-fw/2,-fh+33,fw,fh)}else drawPlaceholderFace(mode==='falling'||(mode==='result'&&stateEngine.state==='fallen'));ctx.restore();ctx.restore();
}
function drawPlaceholderFace(dizzy){
 // A soft blurred disc where the selfie will go, with a simple white line smiley on top.
 const cy=-16,r=58;ctx.save();
 const g=ctx.createRadialGradient(0,cy,r*.35,0,cy,r*1.25);g.addColorStop(0,'rgba(255,255,255,.55)');g.addColorStop(.7,'rgba(255,255,255,.28)');g.addColorStop(1,'rgba(255,255,255,0)');
 ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,cy,r*1.25,0,TAU);ctx.fill();
 ctx.strokeStyle='#fff';ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=4;
 ctx.beginPath();ctx.arc(0,cy,r*.78,0,TAU);ctx.stroke();
 if(dizzy){for(const s of[-1,1]){const ex=s*18,ey=cy-10;ctx.beginPath();ctx.moveTo(ex-7,ey-7);ctx.lineTo(ex+7,ey+7);ctx.moveTo(ex+7,ey-7);ctx.lineTo(ex-7,ey+7);ctx.stroke()}
  ctx.beginPath();ctx.arc(0,cy+20,7,0,TAU);ctx.stroke()}
 else{ctx.fillStyle='#fff';for(const s of[-1,1]){ctx.beginPath();ctx.arc(s*18,cy-10,4.5,0,TAU);ctx.fill()}
  ctx.beginPath();ctx.arc(0,cy+2,24,Math.PI*.15,Math.PI*.85);ctx.stroke()}
 ctx.restore();
}
function star(x,y,r,rotation,color='#ffe052'){ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.beginPath();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,s=i%2?r*.46:r;i?ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s):ctx.moveTo(Math.cos(a)*s,Math.sin(a)*s)}ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#234436';ctx.lineWidth=2;ctx.stroke();ctx.restore()}
function drawScene(dt){
 ctx.clearRect(0,0,W,H);if(!artReady||mode==='idle')return; // the permission card sits on an empty court
 const isIntro=mode==='idle'||mode==='setup';const base=GROUND;
 // Keep the camera unobstructed above a compact foreground play area.
 ctx.save();ctx.translate(W/2,base);ctx.scale(.78,.78);ctx.translate(-W/2,-base);
 ctx.save();ctx.beginPath();ctx.ellipse(W/2,base+8,170,36,0,0,TAU);ctx.clip();
 ctx.drawImage(court,0,court.naturalHeight*.76,court.naturalWidth,court.naturalHeight*.24,W/2-170,base-28,340,72);
 ctx.restore();ctx.beginPath();ctx.ellipse(W/2,base+8,170,36,0,0,TAU);ctx.strokeStyle='#fffdf0';ctx.lineWidth=3;ctx.stroke();
 const fall=mode==='falling'||(mode==='result'&&stateEngine.state==='fallen');const won=mode==='win'||(mode==='result'&&stateEngine.state==='won');
 let height=mode==='playing'?stateEngine.height:mode==='countdown'?Math.sin(animTime*3)*2:isIntro?Math.sin(animTime*2)*3:0;
 let rotation=0,sx=1,sy=1,offsetX=0,drawBase=base;currentPose=null;
 if(fall){
   const t=fallAge;const lean=Math.min(1,t/.27);const tumble=Math.max(0,Math.min(1,(t-.27)/.52));
   rotation=-.20*lean-1.28*(1-Math.pow(1-tumble,3));
   height=t<.27?Math.sin(lean*Math.PI)*13:Math.sin(tumble*Math.PI)*47;
   offsetX=t<.27?4*lean:130*tumble;
   if(t>.79){const bounce=Math.max(0,1-(t-.79)/.65);height=Math.abs(Math.sin((t-.79)*11))*24*bounce;rotation=-1.48+Math.sin((t-.79)*10)*.08*bounce}
   sx=1-.18*tumble+Math.max(0,1-Math.abs(t-.8)/.13)*.12;sy=1-.18*tumble-Math.max(0,1-Math.abs(t-.8)/.13)*.16;
   drawBase=base-5; // Leaves the sideways pose visible under the result card.
 }else if(won){height=Math.abs(Math.sin(winAge*5))*30;rotation=Math.sin(winAge*5)*.09;}
 else if(mode==='playing'&&height>0){
  currentPose=jumpPose(poseKind,(stateEngine.time-stateEngine.jumpAt)/(2*JUMP_VELOCITY/GRAVITY));
  ({rotation,sx,sy,offsetX}=currentPose);
 }
 {const vel=dt>0?(height-prevHeight)/dt:0;prevHeight=height;const target=Math.max(-.42,Math.min(.42,-vel/1300));hairVel+=((target-hairSwing)*170-hairVel*9)*dt;hairSwing=Math.max(-.6,Math.min(.6,hairSwing+hairVel*dt))}
 ctx.save();ctx.translate(240+(fall?20:0),base+2);ctx.scale(fall?1.5:1,1);ctx.beginPath();ctx.ellipse(0,0,75-height*.25,12-height*.015,0,0,TAU);ctx.fillStyle='#183e3c32';ctx.fill();ctx.restore();
 const phase=mode==='playing'?stateEngine.phase:mode==='countdown'?Math.PI*.9:fall?TAU:animTime*1.8;
 const poseRope=()=>{ctx.save();ctx.translate(240+offsetX,base-height);ctx.rotate(rotation);ctx.scale(sx,sy);ctx.translate(-240,-base+height);drawRope(phase,base,height);ctx.restore()};
 // Phase 0 is under the feet, π is over the head. Rising half (sin>0) goes behind the body, falling half in front: back-to-front swing.
 if(!fall&&Math.sin(phase)>=0)poseRope();
 drawAvatar(drawBase,height,rotation,sx,sy,offsetX);
 if(!fall&&Math.sin(phase)<0)poseRope();
 if(fall){
  ctx.save();ctx.strokeStyle='#273f42';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(160,base+5);ctx.bezierCurveTo(235,base+33,359,base-8,364,base-39);ctx.bezierCurveTo(356,base-60,324,base-27,355,base-20);ctx.stroke();ctx.strokeStyle='#ee9cd2';ctx.lineWidth=4.5;ctx.stroke();ctx.restore();
  if(fallAge>.72){for(let i=0;i<4;i++){const a=animTime*2.6+i*Math.PI/2;star(89+Math.cos(a)*47,base-37+Math.sin(a)*16,9,i+animTime)}if(fallAge<1.5){ctx.save();ctx.globalAlpha=Math.max(0,1-(fallAge-.72)/.78);ctx.font='italic 900 55px Impact';ctx.textAlign='center';ctx.lineWidth=5;ctx.strokeStyle='#203a33';ctx.strokeText('BONK!',210,base-82);ctx.fillStyle='#ffe052';ctx.fillText('BONK!',210,base-82);ctx.restore();}}
 }
 for(const p of particles){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=dt*(won?10:70);ctx.save();ctx.globalAlpha=Math.min(1,(p.life-p.age)*2);ctx.translate(p.x,p.y);ctx.rotate(p.age*4);ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*1.6);ctx.restore()}particles=particles.filter(p=>p.age<p.life);
 ctx.restore();
}
function frame(now){
 const rawDt=(now-lastFrame)/1000;const dt=Math.min(.05,Math.max(0,rawDt));lastFrame=now;animTime+=dt;
 if(['playing','countdown'].includes(mode)&&!practice&&!hiddenPause){
   const mic=stream?.getAudioTracks()[0];
   if(!mic||mic.readyState!=='live'||mic.muted||audioContext?.state!=='running'){
     hiddenPause=true;$('pauseReason').textContent='Microphone paused. Tap to continue.';show('resume');$('resume').textContent='Resume';
   }
 }
 if(!hiddenPause){paused=false;show('pauseLayer',false)}
 if(hiddenPause){paused=true;show('pauseLayer');}
 {const live=['countdown','playing','win'].includes(mode)&&!paused&&!document.hidden;if(live&&!music.on)musicStart();else if(!live&&music.on&&mode!=='result'&&mode!=='falling')musicStop(.3)}
 if(mode==='countdown'&&!paused){countdownAge+=dt;const n=countdownAge<3?String(3-Math.floor(countdownAge)):'GO!';if(n!==lastCount){lastCount=n;$('countdown').textContent=n;$('countdown').classList.remove('pop');void $('countdown').offsetWidth;$('countdown').classList.add('pop');sound(n==='GO!'?'go':'count')}if(countdownAge>3.55){stateEngine.start();setMode('playing');}}
 updateVoice(now);
 if(mode==='playing'&&!paused){stateEngine.step(dt);$('time').innerHTML=(DURATION-stateEngine.time).toFixed(1)+'<span>s</span>';$('score').textContent=stateEngine.jumps;}
 if(mode==='falling'){const prev=fallAge;fallAge+=dt;if(prev<.8&&fallAge>=.8)sound('bounce');if(fallAge>=2.1)finish()}
 if(mode==='win'){winAge+=dt;if(winAge>=1.6)finish()}else if(mode==='result'&&stateEngine.state==='won'){winAge+=dt}
 drawScene(paused?0:dt);updateFace(now);requestAnimationFrame(frame);
}
function makeSprite(img){
 // Runtime color-key matte: flood only edge-connected neutral backing.
 // Dark character outlines form the boundary; white clothing stays intact.
 const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
 const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
 const pixels=g.getImageData(0,0,c.width,c.height),d=pixels.data,w=c.width,h=c.height;
 const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 function add(n){if(n<0||n>=w*h||visited[n])return;visited[n]=1;const i=n*4;
   const lo=Math.min(d[i],d[i+1],d[i+2]),hi=Math.max(d[i],d[i+1],d[i+2]);
   if(hi-lo<=13&&lo>64&&hi<247){queue[tail++]=n;d[i+3]=0;}}
 for(let x=0;x<w;x++){add(x);add((h-1)*w+x)}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1)}
 while(head<tail){const n=queue[head++],x=n%w;if(x>0)add(n-1);if(x<w-1)add(n+1);add(n-w);add(n+w)}
 g.putImageData(pixels,0,0);return c;
}
function loadImage(path){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not load '+path));img.src=path})}
const assetsReady=Promise.all([loadImage('./assets/court.png'),...BODIES.map(b=>loadImage(b.src)),...hairImages().map(h=>loadImage(h.cap||h.src))]).then(([a,...rest])=>{court=a;const bs=rest.slice(0,BODIES.length),hs=rest.slice(BODIES.length);bs.forEach((img,i)=>{BODIES[i].img=makeSprite(img)});hairImages().forEach((h,i)=>{h.img=hs[i]});bodyIdx=Math.floor(Math.random()*BODIES.length);body=BODIES[bodyIdx].img;artReady=true;return true}).catch(error=>{setMode('setup');cameraError('The court couldn’t load','Check your connection and reload the page.');$('retryCamera').textContent='Reload game';$('retryCamera').onclick=()=>location.reload();throw error});
assetsReady.catch(()=>{});
$('start').onclick=()=>void startCamera();$('practice').onclick=()=>void startPractice();$('cancelSetup').onclick=()=>void startPractice();$('retryCamera').onclick=()=>void startCamera();
$('jump').onclick=jump;
$('enableMic').onclick=$('setupMic').onclick=()=>{activateAudio();voiceGate.reset()};
$('retryMic').onclick=()=>void startCamera();
$('replay').onclick=()=>{activateAudio();if(practice||!stream)launchCountdown();else{voiceGate.reset();setMode('miccheck');}};
$('resume').onclick=async()=>{activateAudio();if(!practice&&(!stream?.getAudioTracks().some(t=>t.readyState==='live')||detectionErrors>6)){void startCamera();return}try{await audioContext?.resume();if(!practice&&(audioContext?.state!=='running'||stream.getAudioTracks()[0].muted))return;hiddenPause=false;paused=false;show('pauseLayer',false);voiceGate.reset()}catch{}};
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&practice&&mode==='playing'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();jump()}});
canvas.addEventListener('pointerdown',()=>{if(practice)jump()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&['playing','countdown'].includes(mode)){hiddenPause=true;paused=true;$('pauseReason').textContent='Ready when you are. Your timer is paused.';show('resume');$('resume').textContent='Resume game';voiceGate.reset();}lastFrame=performance.now()});
window.addEventListener('pagehide',()=>{stopCamera();landmarker?.close();audioContext?.close()});
if(document.modelContext?.registerTool){const lifecycle=new AbortController();const reg=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}};
 reg({name:'get_game_state',description:'Read the visible game status, timer, jump count and input mode. No camera image is returned.',inputSchema:emptySchema,annotations:{readOnlyHint:true},execute(input){if(Object.keys(input||{}).length)throw new Error('No arguments expected');return snapshot()}});
 reg({name:'start_practice_round',description:'Start the visible camera-free practice round, including the countdown.',inputSchema:emptySchema,annotations:{readOnlyHint:false},async execute(input){if(Object.keys(input||{}).length)throw new Error('No arguments expected');if(['playing','countdown','setup','miccheck'].includes(mode))throw new Error('A round or camera setup is already active');await startPractice();return snapshot()}});
 reg({name:'jump_rope',description:'Press the visible Jump control once in a tap-practice round.',inputSchema:emptySchema,annotations:{readOnlyHint:false},execute(input){if(Object.keys(input||{}).length)throw new Error('No arguments expected');if(!practice||mode!=='playing'||paused)throw new Error('Tap practice is not currently playing');return{jumped:jump(),...snapshot()}}});
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
requestAnimationFrame(frame);
if(new URLSearchParams(location.search).has('debug'))window.__jump={setMode,launchNow,get mode(){return mode},set practice(v){practice=v},get paused(){return paused}}; // test hook, debug only
// ?zones draws TikTok Effect safe zones (390×694 effect canvas) over the game, same as the other games
if(new URLSearchParams(location.search).has('zones')){const zs=document.createElement('style');zs.textContent='.tt-zones{position:absolute;inset:0;z-index:60;pointer-events:none;font:700 10px system-ui}.tt-zones i{position:absolute;box-sizing:border-box}.tt-zones .clip{left:0;top:0;bottom:0;width:4.87%;background:rgba(255,0,80,.18)}.tt-zones .clip.r{left:auto;right:0}.tt-zones .vis{left:4.87%;top:11.96%;width:90.26%;height:37.18%;border:1.5px dashed #4ec9b0}.tt-zones .core2{left:16.67%;top:11.96%;width:66.67%;height:66.57%;border:1.5px dashed #4ec9b0}.tt-zones .core{left:16.67%;top:11.82%;width:66.67%;height:64.99%;border:2px solid #ffe052}.tt-zones .core b{position:absolute;left:3px;bottom:100%;margin-bottom:3px;color:#ffe052}.tt-zones em{position:absolute;font-style:normal}.tt-zones .vl{left:5.6%;top:49.6%;color:#4ec9b0}.tt-zones .cl{left:2px;bottom:6px;color:#ff5c8a}';document.head.append(zs);const zo=document.createElement('div');zo.className='tt-zones';zo.innerHTML='<i class="clip"></i><i class="clip r"></i><i class="vis"></i><i class="core2"></i><i class="core"><b>CORE 260×451</b></i><em class="vl">VISUAL</em><em class="cl">CLIP</em>';document.querySelector('#phone').append(zo);}
