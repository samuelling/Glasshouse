const P=require('../src/physics.js'), D=require('../src/dsp.js');
const shape=process.argv[2]||'bordeaux', fill=+(process.argv[3]||0);
const g=P.buildGlass({shape,material:process.argv[4]||'leadCrystal',tRim:1.2e-3});
const w=P.wetModes(g,fill,{perN:2,fmax:12000});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
function rms(x){let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length);}
const fr=JSON.parse(process.argv[5]||'{}'); Object.assign(D.FINGER.wet,fr);
for(const [rps,FN] of [[0.3,1],[0.6,0.5],[0.6,1],[1,1],[1.5,1],[1,2],[2,1.5]]){
 const fs=48000,V=new D.GlassVoice(fs); V.mp=3e-5;V.kp=1000;V.cp=1.5;V.rough=0.01; V.setModes(w.modes,{Rrim:g.geo.rimR});
 const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN,cond:'wet'});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,seg=[],out=[],onset=null;
 for(let b=0;b<5*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); for(let i=0;i<B;i++) seg.push(L[i]);
  if(seg.length>=fs/4){const a=goertzel(seg,w.modes[0].f,fs),p=a/(rms(seg)*Math.SQRT2+1e-9); if(onset==null&&a>0.05) onset=(b+1)*B/fs; out.push(a.toFixed(2)+(p<0.7?'*':'')); seg=[];}}
 console.log(`${rps}rps v=${(om*g.geo.rimR*100).toFixed(0)}cm/s FN${FN} onset ${onset} | ${out.join(' ')}`);
}
