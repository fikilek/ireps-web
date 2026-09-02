#!/usr/bin/env python3
"""iREPS Sales Work Status v1 - LIVE Endumeni, strictly read only."""
from __future__ import annotations

import argparse, csv, hashlib, json, os, ssl, subprocess, sys, threading, time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

from sales_work_status_classifier import (
    audit_reference_diagnostics, build_grouped_old_inputs, clean_text,
    derive_new_sales_status, derive_old_audit_status, derive_old_frontend_status,
    get_path, inspect_preflight, normalize_meter_identity, normalize_new_sales_row,
    normalize_old_sales_row, normalize_registry_row,
    normalize_sales_work_status_ast_row, transition_reasons,
)

PROJECT="ireps-5c3e9"; ENV="LIVE"; LM="ZA5241"; LM_NAME="Endumeni"
SALES="sales-all-meters"; ASTS="asts"; REG="registry_meters"
EXPECTED_SALES=10216; STEP=500; HEARTBEAT=5
PUBLIC_STATUSES={"COMPLETED","IN_PROGRESS","NOT_STARTED"}

def utc(): return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
def runid(): return datetime.now(timezone.utc).strftime("SALES_WORK_STATUS_AUDIT_%Y%m%dT%H%M%SZ")
def join(values): return "|".join(clean_text(v) for v in values if clean_text(v))
def write_json(path,value): path.write_text(json.dumps(value,indent=2,ensure_ascii=False,default=str)+"\n",encoding="utf-8")
def write_csv(path,fields,rows):
    with path.open("w",newline="",encoding="utf-8-sig") as handle:
        writer=csv.DictWriter(handle,fieldnames=fields,extrasaction="ignore"); writer.writeheader(); writer.writerows(rows)
def git(repo,*args):
    try: return subprocess.run(["git",*args],cwd=repo,capture_output=True,text=True,check=True).stdout.strip()
    except Exception: return ""
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest().upper()
def matrix_rows(counter):
    return [{"fromStatus":a,"toStatus":b,"count":n} for (a,b),n in sorted(counter.items())]

class Tee:
    def __init__(self,path): self.console=sys.stdout; self.file=path.open("w",encoding="utf-8")
    def write(self,value):
        self.console.write(value); self.console.flush(); self.file.write(value); self.file.flush(); return len(value)
    def flush(self): self.console.flush(); self.file.flush()
    def close(self): self.file.close()

class Beat:
    def __init__(self,label,t0): self.label=label; self.t0=t0; self.stop=threading.Event()
    def start(self):
        def run():
            spin="|/-\\"; index=0
            while not self.stop.wait(HEARTBEAT):
                print(f"[{int(time.time()-self.t0):>5}s] [{self.label}] still reading... {spin[index%4]}"); index+=1
        self.thread=threading.Thread(target=run,daemon=True); self.thread.start()
    def end(self): self.stop.set(); self.thread.join(timeout=1)

def parse_args():
    parser=argparse.ArgumentParser(description="READ-ONLY LIVE Endumeni Sales work-status transition audit")
    parser.add_argument("--project-id",required=True); parser.add_argument("--confirm-project",required=True)
    parser.add_argument("--environment",required=True); parser.add_argument("--lm-pcode",required=True)
    parser.add_argument("--lm-name",required=True); parser.add_argument("--service-account",required=True,type=Path)
    parser.add_argument("--report-dir",required=True,type=Path)
    parser.add_argument("--expected-sales-count",type=int,default=EXPECTED_SALES)
    return parser.parse_args()

def gate(args,service_account):
    errors=[]
    if args.project_id!=PROJECT: errors.append(f"project must be {PROJECT}")
    if args.confirm_project!=args.project_id: errors.append("--confirm-project must match --project-id")
    if args.environment.upper()!=ENV: errors.append("environment must be LIVE")
    if args.lm_pcode!=LM: errors.append(f"lm-pcode must be {LM}")
    if args.lm_name.lower()!=LM_NAME.lower(): errors.append(f"lm-name must be {LM_NAME}")
    if not service_account.is_file(): errors.append(f"service account not found: {service_account}")
    metadata={}
    if service_account.is_file():
        try: metadata=json.loads(service_account.read_text(encoding="utf-8"))
        except Exception as error: errors.append(f"invalid service-account JSON: {error}")
    if metadata.get("project_id")!=PROJECT: errors.append(f"service account must belong to {PROJECT}")
    if errors: raise SystemExit("LIVE SAFETY GATE BLOCKED:\n- "+"\n- ".join(errors))

def db(service_account):
    try:
        import requests
        from requests.adapters import HTTPAdapter
        from google.auth.transport.requests import AuthorizedSession,Request
        from google.oauth2 import service_account as google_service_account
    except ImportError as error: raise SystemExit("Install firebase-admin: pip install firebase-admin") from error
    ca_file=os.environ.get("SSL_CERT_FILE")
    context=ssl.create_default_context(cafile=ca_file)
    # Python 3.14 enables X509 strict mode; Avast's local root has a valid but
    # non-critical Basic Constraints extension. Keep chain/hostname checks on.
    if hasattr(ssl,"VERIFY_X509_STRICT"): context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    class LocalCaAdapter(HTTPAdapter):
        def init_poolmanager(self,*args,**kwargs):
            kwargs["ssl_context"]=context
            return super().init_poolmanager(*args,**kwargs)
    credentials=google_service_account.Credentials.from_service_account_file(
        str(service_account),scopes=["https://www.googleapis.com/auth/datastore"]
    )
    auth_transport=requests.Session(); auth_transport.mount("https://",LocalCaAdapter())
    session=AuthorizedSession(credentials,auth_request=Request(auth_transport))
    session.mount("https://",LocalCaAdapter()); session.verify=ca_file or True
    return session

class Snapshot:
    def __init__(self,document_id,data): self.id=document_id; self.data=data
    def to_dict(self): return self.data

def decode_value(value):
    if "nullValue" in value: return None
    if "booleanValue" in value: return value["booleanValue"]
    if "integerValue" in value: return int(value["integerValue"])
    if "doubleValue" in value: return float(value["doubleValue"])
    if "timestampValue" in value: return datetime.fromisoformat(value["timestampValue"].replace("Z","+00:00"))
    if "stringValue" in value: return value["stringValue"]
    if "bytesValue" in value: return value["bytesValue"]
    if "referenceValue" in value: return value["referenceValue"]
    if "geoPointValue" in value: return value["geoPointValue"]
    if "arrayValue" in value: return [decode_value(item) for item in value["arrayValue"].get("values",[])]
    if "mapValue" in value: return {key:decode_value(item) for key,item in value["mapValue"].get("fields",{}).items()}
    return None

def read(session,collection,field_path,label,t0):
    snapshots=[]; beat=Beat(label,t0); beat.start()
    try:
        url=f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents:runQuery"
        payload={"structuredQuery":{"from":[{"collectionId":collection}],"where":{"fieldFilter":{
            "field":{"fieldPath":field_path},"op":"EQUAL","value":{"stringValue":LM}}}}}
        response=session.post(url,json=payload,timeout=300); response.raise_for_status()
        for result in response.json():
            document=result.get("document")
            if not document: continue
            document_id=unquote(document["name"].rsplit("/",1)[-1])
            data={key:decode_value(value) for key,value in document.get("fields",{}).items()}
            snapshots.append(Snapshot(document_id,data))
            if len(snapshots)%STEP==0: print(f"[{int(time.time()-t0):>5}s] [{label}] {len(snapshots):,} read")
    finally: beat.end()
    print(f"[{int(time.time()-t0):>5}s] [{label}] {len(snapshots):,} COMPLETE")
    return snapshots

def old_integrity_codes(snapshot_id,data,asts,registry):
    """Historical reconciliation diagnostics, kept outside public status."""
    codes=[]; meter=normalize_meter_identity(data.get("meterNoNormalized") or data.get("meterNo") or snapshot_id)
    master_id=normalize_meter_identity(get_path(data,"master","id")); visibility=clean_text(get_path(data,"master","visibility")).upper()
    if not meter: codes.append("SALES_METER_IDENTITY_INVALID")
    if meter and normalize_meter_identity(snapshot_id)!=meter: codes.append("SALES_DOCUMENT_ID_MISMATCH")
    if meter and master_id!=meter: codes.append("SALES_MASTER_ID_MISMATCH")
    if clean_text(data.get("lmPcode"))!=LM: codes.append("MISSING_OR_INVALID_SALES_LM_SCOPE")
    if visibility not in {"VISIBLE","INVISIBLE"}: codes.append("SALES_VISIBILITY_INVALID")
    if len(asts)>1: codes.append("DUPLICATE_AST_MATCH")
    if len(registry)>1: codes.append("DUPLICATE_REGISTRY_MATCH")
    if len(asts)==1 and len(registry)==1:
        ast=asts[0]; reg=registry[0]
        if clean_text(reg.get("id"))!=clean_text(reg.get("meterId")): codes.append("REGISTRY_ID_FIELD_MISMATCH")
        if clean_text(reg.get("meterId"))!=clean_text(ast.get("id")): codes.append("AST_REGISTRY_ID_MISMATCH")
        if clean_text(reg.get("lmPcode"))!=LM or clean_text(ast.get("lmPcode"))!=LM: codes.append("LM_SCOPE_MISMATCH")
    if visibility=="VISIBLE":
        if not asts and not registry: codes.append("VISIBLE_SALES_AST_REGISTRY_MISSING")
        elif not asts: codes.append("VISIBLE_SALES_AST_MISSING")
        elif not registry: codes.append("VISIBLE_SALES_REGISTRY_MISSING")
    elif visibility=="INVISIBLE" and len(asts)==1 and len(registry)==1 and not {"REGISTRY_ID_FIELD_MISMATCH","AST_REGISTRY_ID_MISMATCH","LM_SCOPE_MISMATCH"}.intersection(codes):
        codes.append("INVISIBLE_WITH_VALID_AST_REGISTRY")
    return list(dict.fromkeys(codes))

def main():
    args=parse_args(); t0=time.time(); repo=Path.cwd().resolve(); service_account=args.service_account.expanduser().resolve(); gate(args,service_account)
    output=args.report_dir.expanduser().resolve()/runid()/ENV; output.mkdir(parents=True,exist_ok=False)
    tee=Tee(output/"07_console_log.txt"); original=sys.stdout; sys.stdout=tee
    manifest={"mode":"READ_ONLY","projectId":PROJECT,"environment":ENV,"lmPcode":LM,"startedAt":utc(),
      "scriptSha256":sha(Path(__file__).resolve()),"classifierSha256":sha(Path(__file__).resolve().with_name("sales_work_status_classifier.py")),
      "gitBranch":git(repo,"branch","--show-current"),"gitHead":git(repo,"rev-parse","HEAD"),"firestoreWritesPerformed":False}
    write_json(output/"00_run_manifest.json",manifest)
    try:
        print("="*78); print("iREPS SALES WORK STATUS - LIVE READ-ONLY TRANSITION AUDIT")
        print(f"Project={PROJECT} LM={LM}/{LM_NAME} Firestore writes=NO"); print("="*78)
        firestore=db(service_account)
        sales=read(firestore,SALES,"lmPcode","SALES",t0)
        asts=read(firestore,ASTS,"accessData.parents.lmPcode","AST",t0)
        registry=read(firestore,REG,"parents.lmPcode","REGISTRY",t0)

        # The old browser consumed these API projections, never raw Registry/AST docs.
        reg_rows=[normalize_registry_row(s.id,s.to_dict() or {}) for s in registry]
        ast_rows=[normalize_sales_work_status_ast_row(s.id,s.to_dict() or {}) for s in asts]
        reg_map,ast_map=build_grouped_old_inputs(reg_rows,ast_rows)

        status=Counter(); old_audit_counts=Counter(); old_front_counts=Counter(); vis_counts=Counter()
        audit_matrix=Counter(); front_matrix=Counter(); pre_counts=Counter(); pre_rows=Counter()
        diagnostics=Counter(); reasons_count=Counter(); source_shapes=Counter()
        rows=[]; exceptions=[]; progress=[]; duplicate_suppressed=0; correlation_suppressed=0
        recovered_count=0; unexplained=0; unclassified=0
        for index,snapshot in enumerate(sales,1):
            data=snapshot.to_dict() or {}; sid=clean_text(snapshot.id)
            old_sales=normalize_old_sales_row(sid,data)
            meter=normalize_meter_identity(old_sales.get("meterNoNormalized") or old_sales.get("meterNo") or sid)
            reg_matches=reg_map.get(meter,[]); ast_matches=ast_map.get(meter,[])
            old_audit=derive_old_audit_status(data)
            old_front=derive_old_frontend_status(old_sales,reg_matches,ast_matches,LM)
            new_row=normalize_new_sales_row(sid,data); new_status=derive_new_sales_status(new_row)
            status[new_status]+=1; old_audit_counts[old_audit]+=1; old_front_counts[old_front]+=1
            audit_matrix[(old_audit,new_status)]+=1; front_matrix[(old_front,new_status)]+=1
            raw_vis=get_path(data,"master","visibility"); vis_counts[raw_vis if isinstance(raw_vis,str) else "<NON_STRING>"]+=1
            if new_status not in PUBLIC_STATUSES: unclassified+=1

            if "tbRefs" not in data: source_shapes["canonicalAbsent"]+=1
            elif data.get("tbRefs") is None: source_shapes["canonicalNull"]+=1
            elif isinstance(data.get("tbRefs"),list): source_shapes["canonicalArray"]+=1
            else: source_shapes["canonicalOther"]+=1
            if isinstance(data.get("TbRefs"),list) and data.get("TbRefs"): source_shapes["legacyNonemptyArray"]+=1

            pre=inspect_preflight(data)
            for key,value in pre.items():
                amount=int(value) if isinstance(value,bool) else value; pre_counts[key]+=amount
                if value: pre_rows[key]+=1
            entries=new_row["tbRefsIntegrity"].get("entries",[])
            row_duplicate=any(e.get("duplicateLogicalIdentity") for e in entries)
            row_collision=any(e.get("correlationAmbiguous") for e in entries)
            duplicate_suppressed+=int(row_duplicate); correlation_suppressed+=int(row_collision)
            recovered=old_front=="INTEGRITY_EXCEPTION" and new_status=="IN_PROGRESS"; recovered_count+=int(recovered)
            reasons=transition_reasons(old_audit,old_front,new_status,data,new_row)
            for reason in reasons: reasons_count[reason]+=1
            changed=old_audit!=new_status or old_front!=new_status
            explained=not changed or any(r not in {"NO_CHANGE","STRICT_STATUS_CHANGE"} for r in reasons)
            if changed and not explained: unexplained+=1

            row_diag=audit_reference_diagnostics(data,meter)
            for code,count in row_diag.items(): diagnostics[code]+=count
            codes=old_integrity_codes(sid,data,ast_matches,reg_matches)
            if pre["canonicalMalformedWithLegacy"]: codes.append("SALES_TBREFS_CANONICAL_NULL_WITH_LEGACY")
            if pre["legacyAliasReliance"]: codes.append("SALES_TBREF_LEGACY_IDENTITY_ONLY")
            if pre["legacyAliasConflict"]: codes.append("SALES_TBREF_LEGACY_ALIAS_CONFLICT")
            codes.extend(row_diag.keys()); codes=list(dict.fromkeys(codes))
            for code in codes:
                if code not in row_diag: diagnostics[code]+=1
                exceptions.append({"exceptionCode":code,"salesDocId":sid,"meterNoNormalized":meter,
                  "rawVisibility":raw_vis,"oldAuditStatus":old_audit,"oldFrontendStatus":old_front,
                  "newStatus":new_status,"reason":join(reasons)})

            classifiable={key for key,e in new_row["tbRefsIntegrity"].get("entriesByKey",{}).items() if e.get("classifiable") is True}
            for ref in new_row.get("tbRefs",[]):
                key=f"{clean_text(ref.get('id'))}::{clean_text(ref.get('rowId'))}"
                if key in classifiable and get_path(ref,"fieldWork","status")=="IN_PROGRESS":
                    progress.append({"salesDocId":sid,"meterNoNormalized":meter,"tbId":clean_text(ref.get("id")),
                      "rowId":clean_text(ref.get("rowId")),"fieldWorkStatus":"IN_PROGRESS"})
            row={"salesDocId":sid,"meterNoNormalized":meter,"rawVisibility":raw_vis,
              "tbRefCount":len(new_row.get("tbRefs",[])),"aggregateTbRefsValid":new_row["tbRefsIntegrity"].get("valid"),
              "classifiableReferenceCount":sum(e.get("classifiable") is True for e in entries),
              "oldAuditStatus":old_audit,"oldFrontendStatus":old_front,"newStatus":new_status,
              "transitionReasons":join(reasons),"transitionExplained":explained,"duplicateSuppressed":row_duplicate,
              "correlationSuppressed":row_collision,"perReferenceRecovered":recovered,"exceptionCodes":join(codes)}
            rows.append(row)
            if index%STEP==0 or index==len(sales):
                pct=index/len(sales)*100 if sales else 100
                print(f"[{int(time.time()-t0):>5}s] [CLASSIFY] {index:,}/{len(sales):,} ({pct:.1f}%) new={dict(status)}")

        count_ok=len(sales)==args.expected_sales_count; sources_nonzero=all(len(x)>0 for x in (sales,asts,registry))
        total_ok=sum(status.values())==len(sales)
        stop_findings={"salesDenominatorMismatch":not count_ok,"zeroSourceRead":not sources_nonzero,
          "classificationTotalMismatch":not total_ok,"unclassifiedRows":unclassified,"unexplainedTransitions":unexplained,
          "canonicalMalformedWithLegacyRows":pre_rows["canonicalMalformedWithLegacy"],
          "legacyAliasRelianceRows":pre_rows["legacyAliasReliance"],"legacyAliasConflictRows":pre_rows["legacyAliasConflict"],
          "canonicalIdLegacyRowRelianceRows":pre_rows["canonicalIdLegacyRowReliance"],
          "invalidRawVisibilityRows":len(sales)-pre_counts["rawVisibilityValid"],"firestoreWritesPerformed":False}
        stopped=any(bool(v) for k,v in stop_findings.items() if k!="firestoreWritesPerformed")
        summary={"status":"STOP" if stopped else "PASS","projectId":PROJECT,"environment":ENV,"lmPcode":LM,
          "sourceCounts":{"sales":len(sales),"asts":len(asts),"registryMeters":len(registry)},
          "expectedSalesCount":args.expected_sales_count,"salesCountMatchesExpected":count_ok,
          "sourceShapeCounts":dict(sorted(source_shapes.items())),"rawVisibilityCounts":dict(sorted(vis_counts.items())),
          "oldAuditClassification":dict(sorted(old_audit_counts.items())),"oldFrontendClassification":dict(sorted(old_front_counts.items())),
          "newClassification":dict(sorted(status.items())),"classificationTotalMatchesSales":total_ok,
          "oldAuditToNew":matrix_rows(audit_matrix),"oldFrontendToNew":matrix_rows(front_matrix),
          "preflightCounts":dict(sorted(pre_counts.items())),"preflightRowCounts":dict(sorted(pre_rows.items())),
          "diagnosticCounts":dict(sorted(diagnostics.items())),"transitionReasonCounts":dict(sorted(reasons_count.items())),
          "duplicateSuppressed":duplicate_suppressed,"correlationSuppressed":correlation_suppressed,
          "perReferenceRecovered":recovered_count,"allTransitionsExplained":unexplained==0,"stopFindings":stop_findings,
          "elapsedSeconds":round(time.time()-t0,2),"firestoreWritesPerformed":False}

        fields=["salesDocId","meterNoNormalized","rawVisibility","tbRefCount","aggregateTbRefsValid",
          "classifiableReferenceCount","oldAuditStatus","oldFrontendStatus","newStatus","transitionReasons",
          "transitionExplained","duplicateSuppressed","correlationSuppressed","perReferenceRecovered","exceptionCodes"]
        write_json(output/"01_summary.json",summary); write_csv(output/"02_sales_classification.csv",fields,rows)
        write_csv(output/"03_integrity_exceptions.csv",["exceptionCode","salesDocId","meterNoNormalized","rawVisibility","oldAuditStatus","oldFrontendStatus","newStatus","reason"],exceptions)
        write_csv(output/"04_visible_reconciliation.csv",fields,[r for r in rows if r["rawVisibility"]=="VISIBLE"])
        write_csv(output/"05_in_progress_evidence.csv",["salesDocId","meterNoNormalized","tbId","rowId","fieldWorkStatus"],progress)
        write_csv(output/"06_not_started.csv",fields,[r for r in rows if r["newStatus"]=="NOT_STARTED"])
        write_json(output/"08_live_preflight.json",{"preflightCounts":summary["preflightCounts"],"preflightRowCounts":summary["preflightRowCounts"],
          "sourceShapeCounts":summary["sourceShapeCounts"],"rawVisibilityCounts":summary["rawVisibilityCounts"],"stopFindings":stop_findings,"firestoreWritesPerformed":False})
        write_csv(output/"09_status_transitions.csv",fields,rows)
        write_csv(output/"10_old_audit_to_new_matrix.csv",["fromStatus","toStatus","count"],matrix_rows(audit_matrix))
        write_csv(output/"11_old_frontend_to_new_matrix.csv",["fromStatus","toStatus","count"],matrix_rows(front_matrix))
        write_csv(output/"12_transition_reason_counts.csv",["reason","count"],[{"reason":r,"count":n} for r,n in sorted(reasons_count.items())])
        manifest.update({"completedAt":utc(),"resultStatus":summary["status"],"elapsedSeconds":summary["elapsedSeconds"],"firestoreWritesPerformed":False}); write_json(output/"00_run_manifest.json",manifest)
        print("\n"+"="*78); print("AUDIT SUMMARY")
        print(f"STATUS={summary['status']} Sales={len(sales):,} COMPLETED={status['COMPLETED']:,} IN_PROGRESS={status['IN_PROGRESS']:,} NOT_STARTED={status['NOT_STARTED']:,}")
        print(f"PerReferenceRecovered={recovered_count:,} DuplicateSuppressed={duplicate_suppressed:,} UnexplainedTransitions={unexplained:,}")
        print(f"Stop findings={stop_findings}"); print(f"Output={output}"); print("Firestore writes performed: NO"); print("="*78)
        if stopped: raise SystemExit("APPROVED LIVE PRE-FLIGHT STOP CONDITION TRIGGERED. Evidence saved; production implementation must not continue.")
    finally: sys.stdout=original; tee.close()

if __name__=="__main__": main()
