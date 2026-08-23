import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
} from "firebase/firestore";

import { db, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";

const TEAMS_COLLECTION = "teams";

function normalizeCallableError(error, fallbackMessage) {
  return {
    message: error?.message || fallbackMessage,
    code: error?.code || "unknown",
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function normalizeDateValue(value) {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  return String(value);
}

function normalizeTeamDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const team = data.team || {};
  const scope = data.scope || {};
  const ownership = data.ownership || {};
  const metadata = data.metadata || {};

  const status = String(valueOrNav(team.status || data.status)).toUpperCase();
  const name = valueOrNav(team.name || data.name || docSnap.id);

  return {
    id: data.id || docSnap.id,
    type: "TEAM",
    name,
    label: name,
    status,
    code: valueOrNav(team.code || data.code),
    description: valueOrNav(team.description || data.description),
    memberUserIds: asArray(scope.memberUserIds),
    serviceProviderIds: asArray(scope.serviceProviderIds),
    memberCount: asArray(scope.memberUserIds).length,
    serviceProviderCount: asArray(scope.serviceProviderIds).length,
    mncServiceProviderId: valueOrNav(ownership.mncServiceProviderId),
    mncServiceProviderName: valueOrNav(ownership.mncServiceProviderName),
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
      updatedAt: normalizeDateValue(metadata.updatedAt || data.updatedAt),
    },
    raw: data,
  };
}

function sortTeams(left, right) {
  return String(left?.name || left?.id || "").localeCompare(
    String(right?.name || right?.id || ""),
  );
}

function resolveLimit(arg, fallback = 500) {
  const value = typeof arg === "number" ? arg : arg?.limit;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function buildTeamsQuery(maxResults) {
  return query(
    collection(db, TEAMS_COLLECTION),
    limitQuery(maxResults),
  );
}

function buildTeamRows(snapshot) {
  return snapshot.docs
    .map((docSnapshot) => normalizeTeamDoc(docSnapshot))
    .filter(Boolean)
    .filter((team) => team.status === "ACTIVE")
    .sort(sortTeams);
}

function readInitialTeams(arg, signal) {
  const maxResults = resolveLimit(arg, 500);
  const teamsQuery = buildTeamsQuery(maxResults);

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = (result) => {
      if (settled) return;

      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      unsubscribe();
      resolve(result);
    };

    const handleAbort = () => {
      finish({
        error: {
          status: "CUSTOM_ERROR",
          error: "Teams directory stream request was cancelled.",
        },
      });
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

    const streamUnsubscribe = onSnapshot(
      teamsQuery,
      (snapshot) => {
        const teams = buildTeamRows(snapshot);
        const fromCache = snapshot.metadata?.fromCache === true;

        if (fromCache && teams.length === 0) return;

        finish({ data: teams });
      },
      (error) => {
        finish({
          error: {
            status: "CUSTOM_ERROR",
            error: error?.message || "Could not load the Teams directory stream.",
          },
        });
      },
    );

    unsubscribe = streamUnsubscribe;

    if (settled) {
      unsubscribe();
    }
  });
}

export const teamsApi = createApi({
  reducerPath: "teamsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getAvailableTeams: builder.query({
      queryFn: (arg, { signal }) => readInitialTeams(arg, signal),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const maxResults = resolveLimit(arg, 500);
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const teamsQuery = buildTeamsQuery(maxResults);

          unsubscribe = onSnapshot(
            teamsQuery,
            (snapshot) => {
              const teams = buildTeamRows(snapshot);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...teams);
              });
            },
            (error) => {
              console.error("teamsApi getAvailableTeams stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      },
    }),
    createTeam: builder.mutation({
      async queryFn({ name, description = "NAv" }) {
        try {
          const callable = httpsCallable(functions, "createTeam");
          const result = await callable({
            name: String(name || "").trim(),
            description: String(description || "").trim() || "NAv",
          });

          return { data: result?.data || { success: true } };
        } catch (error) {
          return {
            error: normalizeCallableError(error, "Team creation failed."),
          };
        }
      },
    }),

    renameTeam: builder.mutation({
      async queryFn({ teamId, name }) {
        try {
          const callable = httpsCallable(functions, "renameTeam");
          const result = await callable({
            teamId: String(teamId || "").trim(),
            name: String(name || "").trim(),
          });

          return { data: result?.data || { success: true, teamId } };
        } catch (error) {
          return { error: normalizeCallableError(error, "Team rename failed.") };
        }
      },
    }),

    addTeamMember: builder.mutation({
      async queryFn({ teamId, userUid }) {
        try {
          const callable = httpsCallable(functions, "addTeamMember");
          const result = await callable({
            teamId: String(teamId || "").trim(),
            userUid: String(userUid || "").trim(),
          });

          return {
            data: result?.data || { success: true, teamId, userUid },
          };
        } catch (error) {
          return {
            error: normalizeCallableError(error, "Add team member failed."),
          };
        }
      },
    }),

    removeTeamMember: builder.mutation({
      async queryFn({ teamId, userUid }) {
        try {
          const callable = httpsCallable(functions, "removeTeamMember");
          const result = await callable({
            teamId: String(teamId || "").trim(),
            userUid: String(userUid || "").trim(),
          });

          return {
            data: result?.data || { success: true, teamId, userUid },
          };
        } catch (error) {
          return {
            error: normalizeCallableError(error, "Remove team member failed."),
          };
        }
      },
    }),

    deleteTeam: builder.mutation({
      async queryFn({ teamId }) {
        try {
          const callable = httpsCallable(functions, "deleteTeam");
          const result = await callable({
            teamId: String(teamId || "").trim(),
          });

          return { data: result?.data || { success: true, teamId } };
        } catch (error) {
          return { error: normalizeCallableError(error, "Delete team failed.") };
        }
      },
    }),
  }),
});

export const {
  useGetAvailableTeamsQuery,
  useCreateTeamMutation,
  useRenameTeamMutation,
  useAddTeamMemberMutation,
  useRemoveTeamMemberMutation,
  useDeleteTeamMutation,
} = teamsApi;
