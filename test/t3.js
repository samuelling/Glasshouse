const P=require('../src/physics.js');
for(const shape of Object.keys(P.SHAPES)){
 let t0=Date.now();
 const g=P.buildGlass({shape,material:'leadCrystal',tRim:1.2e-3});
 const tb=Date.now()-t0;
 const lines=[];
 for(const fill of [0,0.25,0.5,0.75,0.9]){ t0=Date.now(); const w=P.wetModes(g,fill); const tw=Date.now()-t0;
   const m=w.modes.filter(x=>x.m===0);
   lines.push(`fill ${fill} vol ${(w.volume*1e6).toFixed(0)}mL `+m.map(x=>`n${x.n}:${x.f.toFixed(0)}Hz Q${x.Q.toFixed(0)}(rad ${(x.zRad*2e6).toFixed(1)}u vis ${(x.zVis*2e6).toFixed(1)}u)`).join(' ')+` [${tw}ms]`);
 }
 console.log(shape,'build',tb,'ms','rimR',(g.geo.rimR*1e3).toFixed(1),'L',(g.geo.L*1e3).toFixed(0)); console.log(lines.join('\n'));
}
const g=P.buildGlass({shape:'bordeaux',material:'leadCrystal',tRim:1.2e-3});
const w=P.wetModes(g,0); console.log(w.modes.map(m=>[m.key,m.f.toFixed(0),m.rimV.toFixed(2),m.rimR.toFixed(2),m.rimA.toFixed(2),m.G.toExponential(2)].join(' ')).join('\n'));
