import { useContext } from "react";
import { WardWarehouseContext } from "./WardWarehouseProvider";

export function useWardWarehouse() {
  return useContext(WardWarehouseContext);
}
