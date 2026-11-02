/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// Electricity Meter Population rules EMP-R001 v1.3.0
// Real-time streaming from pre-aggregated summary rollups in report_electricity_population.
import { useEffect, useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetElectricityPopulationByLmQuery } from "../../redux/reportElectricityPopulationApi";
import { getActiveLmPcode, getActiveWorkbaseName } from "../sales/salesUtils";
import {
  EMD_COLORS,
  EMD_HELP_STORIES,
  formatNumber,
  formatPercent,
  formatMonthLabel,
  pickActiveMonth,
} from "./models/electricityMeterPopulationModel";

import "./ProjectPopulationDashboardPage.css";

function HelpButton({ storyKey, onOpen, title }) {
  return (
    <button
      type="button"
      className="emp-help-btn"
      onClick={() => onOpen(storyKey)}
      title={title || "Learn more"}
      aria-label={title || "Learn more"}
    >
      ?
    </button>
  );
}

function KpiCard({ label, value, detail, variant = "", storyKey, onHelp }) {
  return (
    <article className={`emp-kpi ${variant ? `emp-kpi--${variant}` : ""}`}>
      <span className="emp-kpi__label">{label}</span>
      <strong className="emp-kpi__value">{value}</strong>
      <span className="emp-kpi__detail">{detail}</span>
      {storyKey && <HelpButton storyKey={storyKey} onOpen={onHelp} title={`Learn about ${label}`} />}
    </article>
  );
}

function Donut({ normal, targeted, total, onHelp }) {
  const onList = normal + targeted;
  const normalDeg = onList > 0 ? (normal / onList) * 360 : 290;
  const background = onList > 0
    ? `conic-gradient(${EMD_COLORS.normal} 0deg ${normalDeg - 1}deg, #ffffff ${normalDeg - 1}deg ${normalDeg}deg, ${EMD_COLORS.targeted} ${normalDeg}deg 360deg)`
    : "#e2e8f0";

  return (
    <section className="emp-card">
      <div className="emp-card-header">
        <h2>Normal vs targeted</h2>
      </div>

      <div className="emp-donut-box">
        <div
          className="emp-donut"
          style={{ background }}
          role="img"
          aria-label={`Normal ${formatNumber(normal)}, targeted ${formatNumber(targeted)} on Prepaid Sales`}
        >
          <div className="emp-donut__hole">
            <strong>{formatNumber(total)}</strong>
            <span>on Prepaid Sales</span>
          </div>
        </div>
      </div>

      <div className="emp-rows">
        <div className="emp-row">
          <i style={{ background: EMD_COLORS.normal }} aria-hidden="true" />
          <span>Normal</span>
          <strong>{formatNumber(normal)}</strong>
          <span className="emp-muted">{formatPercent(normal, onList)}</span>
        </div>
        <div className="emp-row">
          <i style={{ background: EMD_COLORS.targeted }} aria-hidden="true" />
          <span>Targeted (CAT 1–8)</span>
          <strong style={{ color: EMD_COLORS.targeted }}>{formatNumber(targeted)}</strong>
          <span className="emp-muted">{formatPercent(targeted, onList)}</span>
        </div>
      </div>

      <HelpButton storyKey="card-donut" onOpen={onHelp} title="Learn about Normal vs Targeted" />
    </section>
  );
}

function SplitBar({ title, scope, parts }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);

  return (
    <div className="emp-split">
      <div className="emp-split__head">
        <span className="emp-split__title">{title}</span>
        {scope && <span className="emp-split__scope">{scope}</span>}
      </div>

      <div
        className="emp-split__bar"
        role="img"
        aria-label={`${title}: ${parts.map((p) => `${p.label} ${formatNumber(p.value)}`).join(", ")}`}
      >
        {parts.map((part) => {
          const shareWidth = total > 0 ? (part.value / total) * 100 : 0;
          return (
            <span
              key={part.label}
              className="emp-split__segment"
              style={{ width: `${shareWidth}%`, background: part.color }}
              title={`${part.label}: ${formatNumber(part.value)} (${formatPercent(part.value, total)})`}
            />
          );
        })}
      </div>

      <div className="emp-split__legend">
        {parts.map((part) => (
          <span key={part.label} className="emp-legend">
            <i style={{ background: part.color }} aria-hidden="true" />
            {part.label} <strong>{formatNumber(part.value)}</strong>
            <span className="emp-muted">{formatPercent(part.value, total)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HelpModal({ activeStoryKey, onClose }) {
  if (!activeStoryKey) return null;
  const story = EMD_HELP_STORIES[activeStoryKey];
  if (!story) return null;

  return (
    <div className="emp-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="emp-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="emp-modal-header">
          <span className="emp-modal-badge">{story.badge}</span>
          <button type="button" className="emp-modal-close" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>
        <h3 className="emp-modal-title" id="modal-title">{story.title}</h3>
        <div
          className="emp-modal-body"
          dangerouslySetInnerHTML={{ __html: story.body }}
        />
        <div className="emp-modal-footer">
          <span>iREPS Intelligence</span>
          <a
            href="#academy"
            className="emp-modal-academy"
            onClick={(e) => {
              e.preventDefault();
              alert("iREPS Academy course integration coming soon!");
            }}
          >
            Open in iREPS Academy &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ProjectPopulationDashboardPage() {
  const { activeWorkbase } = useAuth();
  const lmPcode = getActiveLmPcode(activeWorkbase);
  const workbaseName = getActiveWorkbaseName(activeWorkbase);

  const [requestedMonth, setRequestedMonth] = useState("");
  const [activeStoryKey, setActiveStoryKey] = useState(null);

  // Real-time streaming from pre-aggregated rollup collection
  const {
    data: months = [],
    isLoading,
    isError,
  } = useGetElectricityPopulationByLmQuery(lmPcode ? lmPcode : skipToken);

  const activeMonthKey = useMemo(() => pickActiveMonth(months, requestedMonth), [months, requestedMonth]);

  const activePopulation = useMemo(() => {
    return months.find((m) => m.month === activeMonthKey) || months.at(-1) || null;
  }, [months, activeMonthKey]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setActiveStoryKey(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!lmPcode) {
    return (
      <div className="emp-page-container">
        <header className="emp-header">
          <div>
            <p className="emp-eyebrow">Dashboard · Workbase Required</p>
            <h1>Electricity Meter Population</h1>
            <p className="emp-sub">Please select an active local municipality from the navigation bar.</p>
          </div>
        </header>
      </div>
    );
  }

  const pop = activePopulation;

  return (
    <div className="emp-page-container">
      {/* HEADER */}
      <header className="emp-header">
        <div>
          <p className="emp-eyebrow">Dashboard · {workbaseName} ({lmPcode})</p>
          <h1>Electricity Meter Population</h1>
          <p className="emp-sub">
            {pop ? `Electricity meters for ${pop.monthLabel}: from prepaid sales and found in the field` : "Loading electricity meters…"}
          </p>
        </div>

        {/* MONTH SCRUBBER / SELECTOR */}
        {months.length > 0 && (
          <div className="emp-months">
            <span className="emp-months__label">Vending File Month</span>
            <div className="emp-months__buttons" role="group" aria-label="Month selection">
              {months.map((m, index) => {
                const isSelected = m.month === activeMonthKey;
                const isLatest = index === months.length - 1;
                return (
                  <button
                    key={m.month}
                    type="button"
                    className={`emp-month ${isSelected ? "emp-month--on" : ""}`}
                    onClick={() => setRequestedMonth(m.month)}
                  >
                    {m.monthLabel}
                    {isLatest && <span className="emp-month__tag">Latest</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* TOP 5 MASTER KPIS */}
      {pop && (
        <section className="emp-kpis" aria-label="Electricity meters movement this month">
          <KpiCard
            variant="total"
            label="Total meters"
            value={formatNumber(pop.totalMeters)}
            detail="Prepaid sales + found in field"
            storyKey="kpi-total"
            onHelp={setActiveStoryKey}
          />

          <KpiCard
            label="Unchanged"
            value={pop.movements.unchanged != null ? formatNumber(pop.movements.unchanged) : "Data pending"}
            detail="Active continuing from previous month"
            storyKey="kpi-unchanged"
            onHelp={setActiveStoryKey}
          />

          <KpiCard
            label="New"
            value={pop.movements.newMeters != null ? formatNumber(pop.movements.newMeters) : "Data pending"}
            detail="First-time installed on the network"
            storyKey="kpi-new"
            onHelp={setActiveStoryKey}
          />

          <KpiCard
            label="Replacements"
            value={pop.movements.replacements != null ? formatNumber(pop.movements.replacements) : "Data pending"}
            detail="Installed replacing existing meters"
            storyKey="kpi-replacements"
            onHelp={setActiveStoryKey}
          />

          <KpiCard
            variant="removed"
            label="Removed / Out of Service"
            value={pop.movements.removed != null ? formatNumber(pop.movements.removed) : "0"}
            detail="Decommissioned · not in total"
            storyKey="kpi-removed"
            onHelp={setActiveStoryKey}
          />
        </section>
      )}

      {/* MAIN 3-PANEL GRID */}
      {pop && (
        <div className="emp-main">
          {/* PANEL 1: DONUT (NORMAL VS TARGETED ONLY) */}
          <Donut
            normal={pop.normal}
            targeted={pop.targeted}
            total={pop.onList}
            onHelp={setActiveStoryKey}
          />

          {/* PANEL 2: PROJECT SCOPE (3 SPLIT BARS) */}
          <section className="emp-card">
            <div className="emp-scope-head">
              <div>
                <h2>Project scope</h2>
                <span className="emp-muted">Total population</span>
              </div>
              <strong className="emp-scope-total">{formatNumber(pop.totalMeters)}</strong>
            </div>

            {/* Split Bar 1: Prepaid Sales vs Found in Field */}
            <SplitBar
              title="Prepaid sales vs found in the field"
              parts={[
                { label: "Prepaid sales", value: pop.onList, color: EMD_COLORS.onList },
                { label: "Found in the field", value: pop.foundInField, color: EMD_COLORS.foundInField },
              ]}
            />

            {/* Split Bar 2: Normal vs Targeted */}
            <SplitBar
              title="Normal vs targeted"
              scope="Meters on prepaid sales list"
              parts={[
                { label: "Normal", value: pop.normal, color: EMD_COLORS.normal },
                { label: "Targeted", value: pop.targeted, color: EMD_COLORS.targeted },
              ]}
            />

            {/* Split Bar 3: Targeted GPS vs Non-GPS */}
            <SplitBar
              title="GPS vs no GPS"
              scope="Targeted meters (CAT 1–8)"
              parts={[
                { label: "Targeted with GPS", value: pop.targetedWithGps, color: EMD_COLORS.gps },
                { label: "Targeted without GPS", value: pop.targetedWithoutGps, color: EMD_COLORS.noGps },
              ]}
            />

            <HelpButton storyKey="card-scope" onOpen={setActiveStoryKey} title="Learn about Project Scope" />
          </section>

          {/* PANEL 3: KEY NOTES - STRUCTURED BY RELATIONSHIPS */}
          <aside className="emp-card">
            <div className="emp-card-header">
              <h2>Key notes</h2>
            </div>

            <div className="emp-notes-groups">
              {/* Group 1: Population Source */}
              <div className="emp-note-group">
                <div className="emp-note-group__title">
                  <span>1. Population Source</span>
                  <span className="emp-note-group__badge">Total Base</span>
                </div>
                <dl>
                  <div className="emp-note-row">
                    <dt><i style={{ background: EMD_COLORS.onList }} />Prepaid Sales</dt>
                    <dd>
                      <strong>{formatNumber(pop.onList)}</strong>
                      <span className="share">{formatPercent(pop.onList, pop.totalMeters)}</span>
                    </dd>
                  </div>
                  <div className="emp-note-row">
                    <dt><i style={{ background: EMD_COLORS.foundInField }} />Found in Field</dt>
                    <dd>
                      <strong>{formatNumber(pop.foundInField)}</strong>
                      <span className="share">{formatPercent(pop.foundInField, pop.totalMeters)}</span>
                    </dd>
                  </div>
                  <div className="emp-note-row" style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed #cbd5e1" }}>
                    <dt><strong>Total Project Meters</strong></dt>
                    <dd>
                      <strong style={{ color: "var(--emp-accent)" }}>{formatNumber(pop.totalMeters)}</strong>
                      <span className="share">100%</span>
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Group 2: Field Operations Scope */}
              <div className="emp-note-group">
                <div className="emp-note-group__title">
                  <span>2. Operations Scope</span>
                  <span className="emp-note-group__badge">Prepaid Sales</span>
                </div>
                <dl>
                  <div className="emp-note-row">
                    <dt><i style={{ background: EMD_COLORS.normal }} />Normal (Not Inspected)</dt>
                    <dd>
                      <strong>{formatNumber(pop.normal)}</strong>
                      <span className="share">{formatPercent(pop.normal, pop.onList)}</span>
                    </dd>
                  </div>
                  <div className="emp-note-row">
                    <dt><i style={{ background: EMD_COLORS.targeted }} />Targeted (CAT 1–8)</dt>
                    <dd>
                      <strong style={{ color: EMD_COLORS.targeted }}>{formatNumber(pop.targeted)}</strong>
                      <span className="share">{formatPercent(pop.targeted, pop.onList)}</span>
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Group 3: Targeted GPS Dispatch */}
              <div className="emp-note-group">
                <div className="emp-note-group__title">
                  <span>3. Target GPS Breakdown</span>
                  <span className="emp-note-group__badge">Field Target</span>
                </div>
                <dl>
                  <div className="emp-note-row">
                    <dt><i style={{ background: EMD_COLORS.gps }} />Targeted with GPS</dt>
                    <dd>
                      <strong>{formatNumber(pop.targetedWithGps)}</strong>
                      <span className="share">{formatPercent(pop.targetedWithGps, pop.targeted)}</span>
                    </dd>
                  </div>
                  <div className="emp-note-row">
                    <dt><i style={{ background: EMD_COLORS.noGps }} />Targeted without GPS</dt>
                    <dd>
                      <strong>{formatNumber(pop.targetedWithoutGps)}</strong>
                      <span className="share">{formatPercent(pop.targetedWithoutGps, pop.targeted)}</span>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <HelpButton storyKey="card-notes" onOpen={setActiveStoryKey} title="Learn about Key Notes" />
          </aside>
        </div>
      )}

      {/* FOOTER */}
      <footer className="emp-footer">
        <span>Sales records and field records · {workbaseName}</span>
        <span>·</span>
        <span>Prepaid sales stream active</span>
        <span>·</span>
        <span>Real-time sync</span>
      </footer>

      {/* EDUCATIONAL STORY MODAL */}
      <HelpModal activeStoryKey={activeStoryKey} onClose={() => setActiveStoryKey(null)} />
    </div>
  );
}
