// WHO BELONGS TO WHOM. The one place iREPS works out the service-provider
// hierarchy on the web.
//
// Owner, 13 October 2026: **"its simple .. get all RSTE users and RSTE SUBs
// users .. SIMPLE"**, and, pointing at where this already lives: "in the code
// there is a method somewhere that is used to workout the hierarchy. i just
// dont know where it is".
//
// It was in three places and none of them was shared:
//
//   - `functions/teams/helpers.js` - `resolveServiceProviderMnc`, the real
//     answer: it walks UP the chain to the main contractor, at any depth, and
//     refuses to loop. `isUserAllowedInMncHierarchy` is the question this file
//     exists to answer, asked by the server for teams.
//   - `OperationalTeamsPage.jsx` - `buildHierarchyContext`, a private copy that
//     walks ONE HOP, so a subcontractor's subcontractor is lost.
//   - `FwrMonitoringPage.jsx` - `childServiceProviderIds`, one hop again.
//
// Three readings of one fact is how they come to disagree. This is the web's
// one well, and it mirrors the server's recursion rather than inventing a
// shallower rule beside it.
//
// THE RELATIONSHIP IS ALREADY RECORDED and needed no new data. A provider's
// `clients` array says what it is:
//
//   { clientType: "LM", relationshipType: "MNC", id: "ZA5241" }
//       -> this provider is the MAIN CONTRACTOR for that municipality.
//   { clientType: "SP", relationshipType: "SUBC", id: "<provider id>" }
//       -> this provider is a SUBCONTRACTOR of that provider.
//
// Measured in all three environments on 13 October 2026
// (`ireps-investigations/provider-hierarchy-20261013/census.json`): RSTE is the
// main contractor for Endumeni (ZA5241) on DEV, TEST and LIVE. On DEV its four
// subcontractors hold every field worker, so nothing is excluded there. On TEST
// two field workers belong to other families - Nki (Jolinkomo Meters, under
// Fouriot) and Lwazi (Onke Engineering, under 474 Tower) - and both were being
// offered an Endumeni meter. On LIVE RSTE has no subcontractors at all.
//
// THE ID IS THE TRUTH, THE NAME IS A COPY. TEST proves it: two providers carry
// a SUBC client whose id is 474 Tower's and whose stored name still says "Onke
// Engineering". So every function here joins on ids and reads names from the
// provider the id names, never from the client's own copy.

const NAV = "NAv";

/**
 * A trimmed string, or `""`. `NAv` is a gap, not a value, so it reads `""`.
 *
 * EXPORTED, as of 13 October 2026, because every reader of a stored id needs
 * it and the one that did not have it got it wrong. `usersApi` writes the
 * literal word `NAv` into `serviceProviderId` when a person's company is not
 * recorded, and `serviceProvidersApi` writes it into
 * `parentServiceProviderId` when a provider has no parent. A reader that keeps
 * the word treats a GAP AS A COMPANY: truthy, in no holder set, and therefore
 * reported as somebody's employer. That is the owner's NAv rule broken by the
 * very field that implements it.
 */
export function readId(value) {
  return id(value);
}

function id(value) {
  const text = String(value ?? "").trim();

  return text === NAV ? "" : text;
}

const asArray = (value) => (Array.isArray(value) ? value : []);

const upper = (value) => String(value ?? "").trim().toUpperCase();

/**
 * The provider's own `clients`, wherever the caller got the provider from.
 *
 * The web normaliser (`serviceProvidersApi`) flattens a provider and keeps the
 * document under `raw`; the server passes the document itself. Both are read
 * here so a screen never has to know which shape it is holding.
 */
function clientsOf(provider) {
  const own = asArray(provider?.clients);

  return own.length ? own : asArray(provider?.raw?.clients);
}

/** The municipalities this provider is the main contractor for. */
export function mncPcodesOf(provider) {
  return clientsOf(provider)
    .filter(
      (client) =>
        upper(client?.clientType) === "LM" && upper(client?.relationshipType) === "MNC",
    )
    .map((client) => id(client?.id))
    .filter(Boolean);
}

/** Whether this provider is a main contractor for anything. */
export function isMainContractor(provider) {
  return mncPcodesOf(provider).length > 0;
}

/**
 * The provider this one is subcontracted to, by id.
 *
 * Reads the relationship off the document when it is there and falls back to
 * the normalised `parentServiceProviderId`, which is `NAv` when there is none -
 * hence `id()` above, which turns that back into "no parent" instead of
 * treating the word as somebody's key.
 */
export function parentIdOf(provider) {
  const client = clientsOf(provider).find(
    (candidate) =>
      upper(candidate?.clientType) === "SP" && upper(candidate?.relationshipType) === "SUBC",
  );

  return id(client?.id) || id(provider?.parentServiceProviderId);
}

function indexById(providers) {
  const byId = new Map();

  for (const provider of asArray(providers)) {
    const key = id(provider?.id);

    if (key) byId.set(key, provider);
  }

  return byId;
}

/** A provider's display name, from the provider itself. */
export function nameOf(provider) {
  return (
    String(provider?.name ?? "").trim() ||
    String(provider?.profile?.tradingName ?? "").trim() ||
    String(provider?.raw?.profile?.tradingName ?? "").trim() ||
    NAV
  );
}

/**
 * The main contractor a provider sits under, walking up the chain.
 *
 * The mirror of the server's `resolveServiceProviderMnc`. `null` when there is
 * nothing to resolve. Otherwise `id` is the main contractor, or `null` with a
 * `reason` saying why the chain could not be followed - the provider is not in
 * the list, it has no parent and holds no municipality, or the chain loops.
 * Each of those is a different gap, because "this provider has no main
 * contractor" and "this provider is missing from iREPS" are not the same fault.
 */
export function resolveMainContractor(providerId, providers = []) {
  const byId = indexById(providers);
  const seen = new Set();

  let current = id(providerId);

  if (!current) return null;

  while (current && !seen.has(current)) {
    seen.add(current);

    const provider = byId.get(current);

    if (!provider) {
      return { id: null, name: NAV, reason: "PROVIDER_NOT_FOUND", at: current };
    }

    if (isMainContractor(provider)) {
      return { id: id(provider.id), name: nameOf(provider), reason: "OK", provider };
    }

    const parent = parentIdOf(provider);

    if (!parent) {
      return {
        id: null,
        name: NAV,
        reason: "NO_PARENT_AND_HOLDS_NO_MUNICIPALITY",
        at: current,
      };
    }

    current = parent;
  }

  return { id: null, name: NAV, reason: "CIRCULAR", at: current };
}

/**
 * Every main contractor holding this municipality.
 *
 * A SET, not one, because the data has more than one: on TEST, 474 Tower,
 * Fouriot and RSTE are all recorded as main contractor for ZA2157. Reading that
 * as a single value would silently pick one of three and exclude two families
 * of workers who are entitled to the work.
 */
export function mainContractorsHolding(lmPcode, providers = []) {
  const wanted = id(lmPcode);
  const holders = new Set();

  if (!wanted) return holders;

  for (const provider of asArray(providers)) {
    if (mncPcodesOf(provider).includes(wanted)) {
      const key = id(provider?.id);

      if (key) holders.add(key);
    }
  }

  return holders;
}

/**
 * Whether a provider's people may work in this municipality: it is a main
 * contractor there, or it is subcontracted - at any depth - to one that is.
 *
 * `null`, never `false`, when the question cannot be answered: no municipality
 * given, no provider on the record, or iREPS records no main contractor for
 * that municipality at all. The caller then shows the gap rather than enforcing
 * a rule on a fact it does not hold (`UI-R008`) - refusing everybody on missing
 * data would read as "nobody is available" when the truth is "iREPS does not
 * know who holds this municipality".
 */
export function providerMayWorkMunicipality({
  providerId,
  lmPcode,
  providers = [],
} = {}) {
  const holders = mainContractorsHolding(lmPcode, providers);

  if (!holders.size) return null;

  const provider = id(providerId);

  if (!provider) return null;

  if (holders.has(provider)) return true;

  const resolved = resolveMainContractor(provider, providers);

  return Boolean(resolved?.id && holders.has(resolved.id));
}

/**
 * Every provider under these main contractors, the contractors included.
 *
 * Takes a set of main contractor ids and walks each provider's chain up, so a
 * subcontractor's subcontractor is in the family - the depth the server's
 * recursion already allows, and the depth the one-hop copies in the pages
 * missed.
 */
export function familyOf(rootIds, providers = []) {
  const roots = new Set(
    (rootIds instanceof Set ? [...rootIds] : asArray(rootIds))
      .map((value) => id(value))
      .filter(Boolean),
  );

  if (!roots.size) return new Set();

  const family = new Set(roots);

  for (const provider of asArray(providers)) {
    const key = id(provider?.id);

    if (!key || family.has(key)) continue;

    // WALK UP AND LOOK FOR A ROOT ON THE WAY, not only at the top.
    //
    // This asked `resolveMainContractor(key)` and admitted the provider only
    // when its MAIN CONTRACTOR was one of the roots. That is right when the
    // roots ARE main contractors - which is the municipality's question - and
    // WRONG for every other caller. `FwrMonitoringPage` passes the viewer's
    // own provider: for a manager at a subcontractor, his children's chains
    // run past him to the main contractor above, so the top was never his id
    // and the family came back EMPTY. He lost sight of his own people
    // entirely - worse than the one-hop version this replaced, which at least
    // found the generation directly below him.
    const seen = new Set();
    let current = parentIdOf(provider);

    while (current && !seen.has(current)) {
      if (roots.has(current)) {
        family.add(key);
        break;
      }

      seen.add(current);

      const parent = byIdIn(providers, current);

      if (!parent) break;

      current = parentIdOf(parent);
    }
  }

  return family;
}

function byIdIn(providers, wanted) {
  const key = id(wanted);

  return asArray(providers).find((provider) => id(provider?.id) === key) || null;
}

/**
 * The whole family that may work a municipality: its main contractors and
 * every provider whose chain leads up to one of them.
 *
 * `null` when iREPS records no main contractor for the municipality - unknown,
 * which is not the same answer as "nobody". An empty Set would mean nobody.
 */
export function familyForMunicipality({ lmPcode, providers = [] } = {}) {
  const holders = mainContractorsHolding(lmPcode, providers);

  if (!holders.size) return null;

  return familyOf(holders, providers);
}
