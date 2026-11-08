const P=require('../src/physics.js'), D=require('../src/dsp.js');
const g=P.buildGlass({shape:'bordeaux',material:'leadCrystal',tRim:1.2e-3});
const w0=P.wetModes(g,0,{perN:2,fmax:12000});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
function rms(x){let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length);}
function run(cfg,rps,FN,secs=3,w=w0){
 Object.assign(D.FINGER.wet,cfg.fr);
 const fs=48000,V=new D.GlassVoice(fs); Object.assign(V,cfg.pad); V.setModes(w.modes,{Rrim:g.geo.rimR});
 const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN,cond:'wet'});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,last=[];
 for(let b=0;b<secs*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); if(b*B>=(secs-1)*fs) for(let i=0;i<B;i++) last.push(L[i]);}
 const a2=goertzel(last,w.modes[0].f,fs), tot=rms(last)*Math.SQRT2;
 return {a2,purity:a2/(tot+1e-9),ok:a2>0.04&&a2/(tot+1e-9)>0.8};
}
const cases=[[0.4,0.7],[0.7,1],[1,0.6],[1,1.5],[1.4,1],[0.7,2]];
const grid=[];
for(const pad of [{mp:1e-4,kp:1000,cp:1.0},{mp:3e-5,kp:1000,cp:1.5}])
 for(const d of [0.08,0.12,0.18]) for(const eps of [0.03,0.07])
  grid.push({pad:Object.assign({rough:0.01},pad),fr:{mu0:0.6,d,eps,beta:0,Dc:2e-6,vAge:0.002}});
for(const cfg of grid){ const r=cases.map(([rps,FN])=>run(cfg,rps,FN)); const score=r.filter(x=>x.ok).length;
 console.log(score, JSON.stringify(cfg.pad), 'd',cfg.fr.d,'eps',cfg.fr.eps,'|',r.map(x=>x.a2.toFixed(2)+'/'+x.purity.toFixed(2)).join(' '));}
