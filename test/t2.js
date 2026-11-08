const P=require('../src/physics.js'), T=P._t;
// fluid check: rigid-bottom cylinder, analytic Bessel-series added mass for W = z/H shape
const R=0.04,h=0.06,n=2,rho=1;
// analytic: T = rho*pi*R*sum_m (2/h) g_m c_m^2 /2 ... Mf = rho*pi*R*sum (2/h) g_m c_m^2
function In(n,x){let s=0,t=Math.pow(x/2,n);for(let k=1;k<=n;k++)t/=k;for(let k=0;k<200;k++){s+=t;t*=(x*x/4)/((k+1)*(k+1+n));}return s;}
function dIn(n,x){return 0.5*(In(n-1,x)+In(n+1,x));}
let Ma=0; const W=z=>z/h;
for(let m=0;m<4000;m++){const k=(m+0.5)*Math.PI/h; // c=int_0^h (z/h) cos(kz) dz
 const c=(Math.cos(k*h)-1)/(k*k*h)+Math.sin(k*h)/k; const x=k*R; const g= x>40 ? (1/k)*(1/(1-1/(2*x))) : In(n,x)/(k*dIn(n,x)); Ma+=rho*Math.PI*R*(2/h)*g*c*c;}
// numeric via liquidCoupling with fake geometry: vertical wall from z=0 (floor) – use makeGeometry cylinder with tiny thickness
const geo=T.makeGeometry([[40,0],[40,40],[40,80],[40,120]],1,1e-9,1e-9);
const fakeMode={nodes:Float64Array.from([0,geo.L]),x:Float64Array.from([0,0,0,0,0,1/h, 0,0,0,0,geo.L/h,1/h])};
for(const NpNq of [[4,4],[6,6],[8,8]]){
const L=T.liquidCoupling(geo,n,[fakeMode],h,{Np:NpNq[0],Nq:NpNq[1]});
console.log('Ritz',NpNq,L.Mf[0][0].toExponential(5),'analytic',Ma.toExponential(5),'vol',L.vol,Math.PI*R*R*h);}
