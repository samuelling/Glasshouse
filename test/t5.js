const P=require('../src/physics.js'), D=require('../src/dsp.js');
const shape=process.argv[2]||'bordeaux';
const g=P.buildGlass({shape,material:process.argv[3]||'leadCrystal',tRim:1.2e-3});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
function run(fill,rps,FN,cond,secs=2.5){
 const w=P.wetModes(g,fill,{perN:2,fmax:12000});
 const fs=48000,V=new D.GlassVoice(fs); V.setModes(w.modes,{Rrim:g.geo.rimR});
 const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN,cond});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,last=[]; const env=[];
 for(let b=0;b<secs*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); let m=0; for(let i=0;i<B;i++){m=Math.max(m,Math.abs(L[i])); if(b*B>=(secs-0.5)*fs) last.push(L[i]);} if(b%25==24) env.push(m.toFixed(2));}
 const s=V.snapshot();
 const pk=w.modes.slice(0,6).map(m=>`${m.key}@${m.f.toFixed(0)}:${goertzel(last,m.f,fs).toFixed(3)}`).join(' ');
 console.log(`fill ${fill} ${rps}rps v=${(rps*2*Math.PI*g.geo.rimR*100).toFixed(0)}cm/s FN${FN} ${cond} stick ${(s.stick*100).toFixed(0)}%  env[${env.join(' ')}]\n   ${pk}`);
}
for(const rps of [0.25,0.5,1,1.5,2.5]) run(0,rps,1,'wet');
run(0.7,1,1,'wet'); run(0,1,0.3,'wet'); run(0,1,2.5,'wet'); run(0,1,1,'dry'); run(0,1,1,'oily');
