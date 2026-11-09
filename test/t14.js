const P=require('../src/physics.js'), D=require('../src/dsp.js');
const shape=process.argv[2]||'thadobati', mat=process.argv[3]||'bellBronze', fill=+(process.argv[4]||0);
const g=P.buildGlass({shape,material:mat}); const depth=0.015;
const w=P.wetModes(g,fill,{perN:2,fmax:8000,contactDepth:depth}); const rc=g.geo.at(g.geo.L-depth).r;
const cfg=JSON.parse(process.argv[5]||'{}'); Object.assign(D.FINGER.leather,cfg.fl||{}); Object.assign(D.FINGER.wood,cfg.fw||{}); Object.assign(D.PUJA.leather,cfg.pl||{}); Object.assign(D.PUJA.wood,cfg.pw||{});
function goertzel(x,f,fs){let s1=0,s2=0;const c=2*Math.cos(2*Math.PI*f/fs);for(const v of x){const s=v+c*s1-s2;s2=s1;s1=s;}return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/x.length*2;}
function rms(x){let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length);}
console.log(shape,mat,'f2',w.modes[0].f.toFixed(1),'rc',rc.toFixed(3));
for(const stick of (cfg.sticks||['leather','wood'])) for(const side of (cfg.sides||[1])) for(const [rps,F0] of (cfg.cases||[[0.5,4],[0.8,4],[0.8,8],[1.2,6]])){
 const fs=48000,V=new D.GlassVoice(fs); V.split=4e-3; V.setModes(w.modes,{Rrim:rc,split:4e-3}); V.gain=1;
 V.setExciter({kind:'puja',stick,side});
 const om=rps*2*Math.PI; V.setFinger({down:true,theta:0,omega:om,FN:F0});
 const B=480,L=new Float32Array(B),R=new Float32Array(B); let th=0,seg=[],out=[];
 for(let b=0;b<5*fs/B;b++){th+=om*B/fs;V.setFinger({theta:th,omega:om});V.process(L,R,B); for(const x of L) seg.push(x);
  if(seg.length>=fs/2){ let e=0; for(let df=-12;df<=12;df+=2){const a=goertzel(seg,w.modes[0].f+df,fs); e+=a*a/2;} const s=V.snapshot();
    out.push(`${(20*Math.log10(Math.max(1e-7,s.prms)/2e-5)).toFixed(0)}dB/${(Math.sqrt(e)/(rms(seg)+1e-12)).toFixed(1)}/c${(s.contact*100).toFixed(0)}`); seg=[]; } }
 console.log(`${stick.padEnd(7)} ${side>0?'out':'in '} ${rps}rps v=${(om*rc*100).toFixed(0)}cm/s F0=${F0}N | ${out.join(' ')}`);
}
