/* eslint-disable no-unused-vars -- JSX tags are consumed by React. */
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import Wards from "../src/pages/registries/WardsRegistryPage";
import Erfs from "../src/pages/registries/ErfsRegistryPage";
import Premises from "../src/pages/registries/PremisesRegistryPage";
import Meters from "../src/pages/registries/MetersRegistryPage";
import Accounts from "../src/pages/registries/AccountsRegistryPage";
import Trns from "../src/pages/registries/TrnsRegistryPage";
import Mread from "../src/pages/registries/MreadRegistryPage";
import Staging from "../src/pages/registries/MreadStagingPage";
import "../src/index.css";
import "../src/App.css";
const pages = {Wards, ERFs:Erfs, Premises, Meters, Accounts, TRNs:Trns, MREAD:Mread, "MREAD Staging":Staging};
export function Preview() {
  const [name,setName] = useState("Wards");
  const Page = pages[name];
  return <MemoryRouter><main style={{padding:24}}>
    <p>Registry migration dev review · Fixture data · No backend writes</p>
    <label>Preview registry <select value={name} onChange={event=>setName(event.target.value)}>{Object.keys(pages).map(name=><option key={name}>{name}</option>)}</select></label>
    <Page key={name}/>
  </main></MemoryRouter>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
