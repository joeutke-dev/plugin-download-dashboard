// plotly.js-dist-min ships no type definitions; we only use a tiny surface
// (react/purge), so declare it loosely as `any`.
declare module "plotly.js-dist-min" {
	const Plotly: any;
	export default Plotly;
}
