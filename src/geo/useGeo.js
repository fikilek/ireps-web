import { useContext } from "react";
import { GeoContext } from "./GeoContext";

export const useGeo = () => {
  const ctx = useContext(GeoContext);

  if (!ctx) {
    throw new Error("useGeo must be used within GeoProvider");
  }

  return ctx;
};
