const P=require('../src/physics.js'), D=require('../src/dsp.js');
const g=P.buildGlass({shape:'bordeaux',material:'leadCrystal',tRim:1.2e-3});
const w0=P.wetModes(g,0,{perN:2,fmax:12000});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
function run(label,fr,rps,FN,secs=5,w=w0){
 Object.assign(D.FINGER.wet,fr);
 const fs=48000,V=new D.GlassVoice(fs); V.setModes(w.modes,{Rrim:g.geo.rimR});
 const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN,cond:'wet'});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,seg=[],out=[];
 for(let b=0;b<secs*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); for(let i=0;i<B;i++) seg.push(L[i]);
  if(seg.length>=fs/2){ const amps=w.modes.slice(0,4).map(m=>goertzel(seg,m.f,fs)); const best=amps.indexOf(Math.max(...amps)); out.push(`${w.modes[best].key}:${amps[best].toFixed(3)}`); seg=[]; } }
 const s=V.snapshot();
 console.log(label.padEnd(34),`${rps}rps FN${FN} stick ${(s.stick*100).toFixed(0)}% |`,out.join(' '));
}
const base={muS:1.0,muK:0.45,vS:0.12,beta:0,Dc:4e-5,vAge:0.01};
const v=JSON.parse(process.argv[2]||'{}');
for(const rps of [0.5,1,1.5]) for(const FN of [0.7,1.5]) run(JSON.stringify(v),Object.assign({},base,v),rps,FN);
