const P=require('../src/physics.js'), D=require('../src/dsp.js');
const g=P.buildGlass({shape:'bordeaux',material:'leadCrystal',tRim:1.2e-3});
const w=P.wetModes(g,0,{perN:2,fmax:12000});
Object.assign(D.FINGER.wet,{d:0.15,eps:0.05});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
for(const [rps,scale,rough] of [[1.5,1,0.01],[0.1,15,0.01],[1.5,1,0],[0.1,15,0]]){
 const fs=48000,V=new D.GlassVoice(fs); V.mp=3e-5;V.kp=1000;V.cp=1.5;V.rough=rough; V.setModes(w.modes,{Rrim:g.geo.rimR*scale});
 const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN:1,cond:'wet'});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,seg=[],out=[];
 for(let b=0;b<4*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); for(let i=0;i<B;i++) seg.push(L[i]); if(seg.length>=fs/4){out.push(goertzel(seg,w.modes[0].f,fs).toFixed(3));seg=[];}}
 console.log(rps,scale,rough,'vb',V.vb.toFixed(2),out.join(' '));
}
