// Run inside the built image, with installed test packs mounted at /data/nest-features.
// Network access is unnecessary: all four combinations must restart offline.
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 for(const [vision,speech,failure] of [[false,false],[true,false],[false,true],[true,true],[true,true,true]]) {
  const root=`/tmp/matrix-${vision}-${speech}`;
 const auth={headers:{Authorization:'Bearer isolated-api-test'}};
  fs.mkdirSync(root,{recursive:true});
  fs.cpSync('/data/nest-features',root+'/features',{recursive:true});
  if (failure) {
   fs.rmSync(root+'/features',{recursive:true,force:true});
   fs.mkdirSync(root+'/bin',{recursive:true});
   fs.writeFileSync(root+'/bin/npm','#!/bin/sh\nexit 1\n',{mode:0o755});
  }
  fs.mkdirSync(root+'/config/nest_snapshots',{recursive:true});
  fs.writeFileSync(root+'/config/nest_snapshots/test.jpg',Buffer.from([255,216,255,217]));
  fs.writeFileSync(root+'/options.json', JSON.stringify({enable_vision:vision,enable_speech:speech,api_token:'isolated-api-test',allowed_cameras:['camera.test']}));
  let log='';
  const child=spawn('/bin/sh',['/run.sh'],{env:{...process.env,PATH:failure?root+'/bin:'+process.env.PATH:process.env.PATH,LOG_FILE:root+'/boot.log',HA_CONFIG_DIR:root+'/config',FEATURE_DATA_DIR:root+'/features',OPTIONS_FILE:root+'/options.json',ENABLE_VISION:String(!vision),ENABLE_SPEECH:String(!speech),PORT:'8098',HA_TOKEN:'isolated-test',HA_WS_URL:'ws://127.0.0.1:1'}});
  child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  try {
   let status;
   for(let n=0;n<150;n++) {
    if(child.exitCode!==null)throw Error('server exited: '+log+(fs.existsSync(root+'/boot.log')?fs.readFileSync(root+'/boot.log','utf8'):''));
    try {const r=await fetch('http://127.0.0.1:8098/',auth); if(r.ok){status=await r.json();break;}}catch{}
    await sleep(100);
   }
   log += fs.existsSync(root+'/boot.log')?fs.readFileSync(root+'/boot.log','utf8'):'';
   assert(status,'server did not start: '+log);
   assert.equal(status.features.vision.enabled,vision&&!failure,log);
   assert.equal(status.features.speech.enabled,speech&&!failure,log);
   assert.equal((await fetch('http://127.0.0.1:8098/health')).status,200);
   assert.equal((await fetch('http://127.0.0.1:8098/latest/test.jpg',auth)).status,200);
   assert.equal((await fetch('http://127.0.0.1:8098/zones',auth)).status,vision&&!failure?200:503);
   if(!speech||failure)assert.equal((await fetch('http://127.0.0.1:8098/listen/test',{...auth,method:'POST'})).status,503);
   assert.equal(fs.existsSync(root+'/features/vision'),vision&&!failure);
   assert.equal(fs.existsSync(root+'/features/speech'),speech&&!failure);
   if (failure) assert(log.includes('capture remains available'),log); else assert(!log.includes('Installing optional'),log);
   console.log(`PASS offline launcher: vision=${vision}, speech=${speech}, failed download=${!!failure}; API and package removal verified`);
  } finally {
   if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM'); await exited; }
   fs.rmSync(root,{recursive:true,force:true});
  }
 }
})().catch(e=>{console.error(e);process.exit(1)});
