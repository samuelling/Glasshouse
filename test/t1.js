const P=require('../src/physics.js'), T=P._t;
// Bessel checks
console.log('J0(1)',T.besselJ(0,1),'0.7651976866');
console.log('Y0(1)',T.besselY(0,1),'0.0882569642');
console.log('Y1(1)',T.besselY(1,1),'-0.7812128213');
console.log('Y2(1)',T.besselY(2,1),'-1.650682607');
console.log('Y3(2.5)',T.besselY(3,2.5),'-0.7461');
// eig check
const A=[[4,1,2],[1,3,0],[2,0,5]]; const r=T.symEig(A); console.log(r.values);
// free-free cylinder vs ring formula
const mat={E:70e9,rho:2500,nu:0.22,eta:0};
const R=40,Hh=100, t=1e-3;
const geo=T.makeGeometry([[R,0],[R,Hh/3],[R,2*Hh/3],[R,Hh]],1,t,t);
for(const n of [2,3,4]){
 const m=T.shellModes(geo,mat,n,{Ne:30,nKeep:3,clamp:false});
 const Rm=R*1e-3, w2=mat.E*t*t*n*n*(n*n-1)**2/(12*mat.rho*(1-mat.nu**2)*Rm**4*(n*n+1));
 console.log('n',n,'FE',m.map(x=>(x.omega/2/Math.PI).toFixed(1)).join(','),'ring',(Math.sqrt(w2)/2/Math.PI).toFixed(1));
}
// clamped cylinder convergence
for(const Ne of [12,24,48]){
 const m=T.shellModes(geo,mat,2,{Ne,nKeep:2});
 console.log('clamped Ne',Ne,m.map(x=>(x.omega/2/Math.PI).toFixed(2)).join(','));
}
