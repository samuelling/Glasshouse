const P=require('../src/physics.js');
for(const [shape,mat] of [['thadobati','bellBronze'],['thadobati','himalayan'],['jambati','bellBronze'],['manipuri','bellBronze'],['hand','bellBronze'],['crystal','fusedQuartz']]){
 const t0=Date.now(); const g=P.buildGlass({shape,material:mat,scale:1}); const tb=Date.now()-t0;
 let mass=0; {const L=g.geo.L; for(let i=0;i<400;i++){const s=(i+0.5)*L/400,a=g.geo.at(s); mass+=2*Math.PI*a.r*a.t*L/400*g.mat.rho;}}
 for(const fill of [0,0.5]){ const w=P.wetModes(g,fill,{perN:2,fmax:8000,contactDepth:0.015});
  const m0=w.modes.filter(m=>m.m===0), f2=m0[0].f;
  console.log(shape.padEnd(10),mat.padEnd(11),`mass ${(mass*1000).toFixed(0)}g Ø${(g.geo.rimR*2000).toFixed(0)} build ${tb}ms fill ${fill}:`, m0.map(m=>`n${m.n} ${m.f.toFixed(0)}Hz(${(m.f/f2).toFixed(2)}) Q${m.Q.toFixed(0)}`).join(' '), `vol ${(w.volume*1e6).toFixed(0)}mL`, `pR ${m0[0].rimR.toFixed(2)} pT ${m0[0].rimV.toFixed(2)}`);
 }
}
