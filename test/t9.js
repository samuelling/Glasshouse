const P=require('../src/physics.js'), D=require('../src/dsp.js');
const g=P.buildGlass({shape:process.argv[2]||'bordeaux',material:'leadCrystal',tRim:1.2e-3});
const w=P.wetModes(g,+(process.argv[3]||0),{perN:2,fmax:12000});
const cfg=JSON.parse(process.argv[4]||'{}');
Object.assign(D.FINGER.wet,cfg.fr||{});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
function rms(x){let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length);}
let score=0;
for(const [rps,FN] of [[0.3,1],[0.6,0.5],[0.6,1],[1,1],[1.5,1],[1,2],[2,1.5],[1,0.4]]){
 const fs=48000,V=new D.GlassVoice(fs); Object.assign(V,{mp:3e-5,kp:1000,cp:1.5,rough:0.01},cfg.pad||{}); V.setModes(w.modes,{Rrim:g.geo.rimR});
 const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN,cond:'wet'});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,seg=[],out=[],onset=null,lastp=0,lasta=0;
 for(let b=0;b<4*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); for(let i=0;i<B;i++) seg.push(L[i]);
  if(seg.length>=fs/4){let e=0;for(let df=-24;df<=24;df+=4){const a=goertzel(seg,w.modes[0].f+df,fs);e+=a*a/2;} const a=Math.sqrt(2*e), p=Math.sqrt(e)/(rms(seg)+1e-9); if(onset==null&&a>0.05) onset=(b+1)*B/fs; out.push(a.toFixed(2)+(p<0.7?'*':'')); lastp=p;lasta=a;seg=[];}}
 if(lasta>0.05&&lastp>0.7) score++;
 console.log(`${rps}rps v=${(om*g.geo.rimR*100).toFixed(0)}cm/s FN${FN} onset ${onset} | ${out.join(' ')}`);
}
console.log('score',score);
