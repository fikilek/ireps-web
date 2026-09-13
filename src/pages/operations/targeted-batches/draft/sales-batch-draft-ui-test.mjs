import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { transformWithOxc } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import * as model from "./sales-batch-draft-model.js";
import * as styles from "./targetedBatchDraftReviewStyles.js";
const hooks={useEffect:()=>{},useMemo:fn=>fn(),useRef:value=>({current:value}),useState:value=>[typeof value==="function"?value():value,()=>{}]};
const component=()=>null;
async function load(relative,mocks={},globals={},apiKey="offline-mock") {
 const file=new URL(relative,import.meta.url);
 const source=(await readFile(file,"utf8")).replace("import.meta.env.VITE_GOOGLE_MAPS_API_KEY",JSON.stringify(apiKey));
 const {code}=await transformWithOxc(source,file.pathname,{jsx:{runtime:"automatic"}});
 const context=createContext({console,Date,window:{},...globals});
 const module=new SourceTextModule(code,{context});
 await module.link(name=>{
  const value=name==="react"?hooks:name==="react/jsx-runtime"?jsx:mocks[name];
  assert.ok(value,`Missing mock: ${name}`);
  return new SyntheticModule(Object.keys(value),function(){for(const [key,item] of Object.entries(value))this.setExport(key,item);},{context});
 });
 await module.evaluate();return module.namespace;
}
test("Clear draft cancellation preserves the draft; confirmation returns each Sales origin to its table", async () => {
 for(const source of ["PREPAID_SALES_NON_GPS","PREPAID_SALES"]) {
  const scope={uid:"A",lmPcode:"ZA5241"}, actions=[], navigations=[], prompts=[];let accepted=false;
  const draft=model.buildRetainedSalesDraft({source:{type:source},scope,scopeKey:JSON.stringify(scope),selection:{},rows:[{id:"00123"}]},"TB");
  const before=structuredClone(draft);
  const mutation=()=>[()=>assert.fail("Clear draft must not call a Function"),{isLoading:false}];
  const page=await load("../../TargetedBatchDraftPage.jsx",{
   "react-router-dom":{Link:component,useNavigate:()=> (...args)=>navigations.push(args)},
   "react-redux":{useDispatch:()=>action=>actions.push(action),useSelector:()=>draft},
   "../../auth/useAuth":{useAuth:()=>({activeWorkbase:{id:"ZA5241"}})},
   "../../redux/salesApi":{useSalesReadScope:()=>scope},
   "../../redux/mapLmsApi":{useGetLmBoundaryByIdQuery:code=>{assert.equal(code,"ZA5241");return{};}},
   "../../redux/targetedBatchDraftSlice":{selectTargetedBatchDraft:()=>draft,clearTargetedBatchDraft:()=>({type:"clear"}),updateSalesDraftResolution:()=>{},saveSalesDraftFence:()=>{},removeSalesDraftMeter:()=>{},setSalesDraftConfirmation:()=>{},setSalesDraftUncertainRequest:()=>{}},
   "../../redux/salesTargetedBatchApi":{useGetSalesBatchDraftSnapshotQuery:()=>({data:{ready:false}}),useResolveSalesTargetedBatchMutation:mutation,useSaveSalesTargetedBatchGeofenceMutation:mutation,useAssessSalesTargetedBatchMutation:mutation,useCreateSalesTargetedBatchMutation:mutation},
   "../../features/maps/use-geofence-polygon-draft":{useGeofencePolygonDraft:()=>({points:[]})},
   "./targeted-batches/draft/sales-batch-draft-model":model,
   "./targeted-batches/TargetedBatchDraftReview":{default:component},
   "./targeted-batches/TargetedBatchConfirmModal":{default:component},
   "./targeted-batches/draft/targetedBatchDraftReviewStyles":styles,
  },{window:{confirm:text=>{prompts.push(text);return accepted;}}});
  const session=page.default().props.children[1];
  const review=session.type(session.props).props.children[0];
  review.props.onClear();assert.equal(actions.length,0);assert.equal(navigations.length,0);assert.deepEqual(draft,before);
  accepted=true;review.props.onClear();
  assert.equal(actions.length,1);assert.equal(actions[0].type,"clear");assert.equal(navigations.length,1);
  assert.equal(navigations[0][0],model.salesDraftReturnPath(source));assert.equal(navigations[0][1].replace,true);
  assert.equal(Object.hasOwn(navigations[0][1],"state"),false);
  assert.equal(prompts[0],"Clear this draft and go back to the meter table? A geofence you already saved stays saved.");
 }
});
test("shared map stays mounted without assets and shows a banner; missing key still blocks the SDK", async () => {
 const mocks={"@googlemaps/markerclusterer":{MarkerClusterer:class{}},"@vis.gl/react-google-maps":{APIProvider:({children})=>children,Map:({children,defaultCenter})=>jsx.jsxs("div",{"data-map":"present","data-center":JSON.stringify(defaultCenter),children}),useMap:()=>null}};
 const map=await load("../../../sales/components/SalesTargetedBatchMap.jsx",mocks);
 const viewport={center:{lat:-28.4,lng:30.5},zoom:10,scope:"LM"};
 const markup=renderToStaticMarkup(jsx.jsx(map.default,{viewport}));
 assert.match(markup,/data-map="present"/);assert.match(markup,/-28.4/);assert.match(markup,/role="status"/);assert.match(markup,/No usable spatial features/);
 assert.doesNotMatch(markup,/Meter state colours remain neutral/);
 const withWard=renderToStaticMarkup(jsx.jsx(map.default,{viewport,hasDraftBoundary:true,children:jsx.jsx("span",{children:"Ward boundary"})}));
 assert.match(withWard,/Ward boundary/);assert.doesNotMatch(withWard,/No usable spatial features/);
 const standalone=renderToStaticMarkup(jsx.jsx(map.default,{}));assert.match(standalone,/data-map="present"/);
 const noKey=await load("../../../sales/components/SalesTargetedBatchMap.jsx",mocks,{},"");
 const missing=renderToStaticMarkup(jsx.jsx(noKey.default,{}));assert.match(missing,/Google Maps key missing/);assert.doesNotMatch(missing,/data-map/);
});
test("shared secondary actions match Create dimensions and preserve visible disabled styling", () => {
 const secondary=styles.draftButtonStyle(),primary=styles.draftButtonStyle(false,true),disabled=styles.draftButtonStyle(true);
 for(const key of ["minHeight","fontFamily","fontSize","lineHeight","borderRadius","padding","fontWeight"])assert.equal(secondary[key],primary[key],key);
 assert.ok(disabled.opacity<1);assert.equal(disabled.cursor,"not-allowed");assert.notEqual(primary.background,secondary.background);
});
