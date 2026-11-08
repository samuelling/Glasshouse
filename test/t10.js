const P=require('../src/physics.js'), D=require('../src/dsp.js');
const g=P.buildGlass({shape:'bordeaux',material:'leadCrystal'}); const w=P.wetModes(g,0,{perN:2,fmax:12000});
function rms(x){let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length);}
for(const cond of ['wet','dry','oily']){
 const fs=48000,V=new D.GlassVoice(fs); V.setModes(w.modes,{Rrim:g.geo.rimR}); const om=2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN:1,cond});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,o=[];
 for(let b=0;b<300;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); if(b%50==49)o.push((20*Math.log10(V.snapshot().prms/2e-5)).toFixed(0));}
 console.log(cond,o.join(' '));
}
// tap and ring-down
const fs=48000,V=new D.GlassVoice(fs); V.setModes(w.modes,{Rrim:g.geo.rimR}); V.tap(0.3,6);
const B=4800,L=new Float32Array(B),R=new Float32Array(B); const o=[];
for(let b=0;b<60;b++){V.process(L,R,B); if(b%6==0) o.push((20*Math.log10(Math.max(1e-9,V.snapshot().prms)/2e-5)).toFixed(0));}
console.log('tap decay dB every 0.6s:',o.join(' '));
