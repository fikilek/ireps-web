/* eslint-disable no-unused-vars -- JSX components are consumed by React. */
import { createRoot } from "react-dom/client";
import UsersPage from "../src/pages/users/UsersPage";
import "../src/index.css";
import "../src/App.css";
createRoot(document.getElementById("root")).render(<>
  <p style={{margin:16,color:'#475569'}}>Admin Users dev review · Fixture data · No backend writes</p>
  <UsersPage />
</>);
