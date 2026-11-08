const P=require('../src/physics.js'), D=require('../src/dsp.js');
const g=P.buildGlass({shape:'bordeaux',material:'leadCrystal'});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
for(const os of [1,2]) for(const perN of [1,2]){
 const w=P.wetModes(g,0.3,{perN,fmax:12000}); let score=0,res=[];
 for(const [rps,FN] of [[0.6,1],[1,1],[1.5,1],[1,2],[0.6,0.5]]){
  const fs=48000,V=new D.GlassVoice(fs); V.os=os; V.dt=1/(fs*os); V.setModes(w.modes,{Rrim:g.geo.rimR});
  const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN,cond:'wet'});
  const B=128,L=new Float32Array(B),R=new Float32Array(B); let th=0,last=[]; const t0=Date.now();
  for(let b=0;b<3*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); if(b*B>2*fs) for(const x of L) last.push(x);}
  const a=goertzel(last,w.modes[0].f,fs); res.push(a.toFixed(2)+'('+(Date.now()-t0)+'ms)');
 }
 console.log('os',os,'perN',perN,'osc',w.modes.length*2,res.join(' '));
}
