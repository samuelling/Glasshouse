const P=require('../src/physics.js'), D=require('../src/dsp.js');
const g=P.buildGlass({shape:'bordeaux',material:'leadCrystal',tRim:1.2e-3});
function run(fill,revPerSec,FN,cond,secs=3){
 const w=P.wetModes(g,fill,{perN:2,fmax:12000});
 const fs=48000, V=new D.GlassVoice(fs); V.Rrim=g.geo.rimR; V.setModes(w.modes,{Rrim:g.geo.rimR});
 const om=revPerSec*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN,cond});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0;
 const rows=[]; let buf=[];
 for(let b=0;b<secs*fs/B;b++){ th+=om*B/fs; V.setFinger({theta:th,omega:om}); V.process(L,R,B); for(let i=0;i<B;i++) buf.push(L[i]);
   if((b+1)%50==0){ const s=V.snapshot(); // zero-cross freq
     let zc=0; for(let i=1;i<buf.length;i++) if(buf[i-1]<0&&buf[i]>=0) zc++; const f=zc/(buf.length/fs);
     let mx=0; for(const x of buf) mx=Math.max(mx,Math.abs(x));
     rows.push(`${((b+1)*B/fs).toFixed(1)}s peak ${mx.toFixed(3)} f~${f.toFixed(0)} stick ${(s.stick*100).toFixed(0)}% p ${(20*Math.log10(s.prms/2e-5)).toFixed(0)}dB`); buf=[]; }
 }
 // rim radial amplitude estimate
 const s=V.snapshot(); let amax=0; for(let k=0;k<V.N;k++){ const a=Math.hypot(s.amps[2*k],s.amps[2*k+1])*Math.abs(V.aR[k]); amax=Math.max(amax,a);} 
 console.log(`fill ${fill} ${revPerSec}rev/s FN ${FN} ${cond}: f2=${w.modes[0].f.toFixed(1)}  rimAmp ${(amax*1e6).toFixed(1)}um`); console.log(rows.filter((_,i)=>i%2==1).join('\n'));
}
let t0=Date.now();
run(0,1,1,'wet');
console.log('time',Date.now()-t0,'ms for 3s audio');
run(0.6,1,1,'wet',2);
run(0,0.3,1,'wet',2);
run(0,1,1,'oily',2);
run(0,1,1,'dry',2);
run(0,1,3,'wet',2);
