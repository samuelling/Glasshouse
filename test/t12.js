const P=require('../src/physics.js'); const S=P.makeService(); const cfg={shape:'bordeaux',material:'leadCrystal',tRim:1.2e-3};
let t=Date.now(); const b=S.handle({cmd:'build',id:0,cfg:Object.assign({scale:1},cfg)}); console.log('build',Date.now()-t,'ms',b.info, b.wet.f);
for(const hz of [550,500,440,700]){ t=Date.now(); const r=S.handle({cmd:'tune',id:0,hz}); console.log('tune',hz,'->',r.wet.f.toFixed(2),'fill',r.wet.fill.toFixed(3),r.inRange,Date.now()-t,'ms'); }
for(const hz of [261.6,523.3,880,1568]){ t=Date.now(); const r=S.handle({cmd:'fit',id:1,hz,cfg}); console.log('fit',hz,'scale',r.info.scale.toFixed(3),'->',r.wet.f.toFixed(2),'fill',r.wet.fill.toFixed(2),'range',r.info.fFull.toFixed(0),'-',r.info.fDry.toFixed(0),Date.now()-t,'ms'); }
