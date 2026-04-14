const OFFICIAL_MENU_URL = "https://dining.purdue.edu/menus/";
const OFFICIAL_GRAPHQL_URL = "https://api.hfs.purdue.edu/menus/v3/GraphQL";
const PURDUE_TIMEZONE = "America/Indiana/Indianapolis";

const RESIDENTIAL_DINING_COURTS = ["Earhart", "Ford", "Hillenbrand", "Wiley", "Windsor"];

const DAILY_MENU_QUERY = `
  query DailyMenu($name: String!, $date: Date!) {
    diningCourtByName(name: $name) {
      name
      formalName
      dailyMenu(date: $date) {
        notes
        meals {
          name
          type
          status
          startTime
          endTime
          stations {
            name
            items {
              displayName
              specialName
              item {
                name
                isNutritionReady
                ingredients
                nutritionFacts {
                  name
                  label
                  value
                }
                traits {
                  name
                  type
                }
              }
            }
          }
        }
      }
    }
  }
`;

function formatDateInTimezone(date = new Date(), timeZone = PURDUE_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function roundOrNull(value, digits = 1) {
  if (!isNumber(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function isSuspiciousServing(servingSize, macros) {
  const normalizedSize = String(servingSize || "").toLowerCase();
  const bulkServingPattern = /\bbatch\b|\bcase\b|\bpan\b|\btray\b|\bgal\b|\bct\b|\bcs\b/;

  if (bulkServingPattern.test(normalizedSize)) {
    return true;
  }

  return (
    (isNumber(macros.calories) && macros.calories > 1200) ||
    (isNumber(macros.protein) && macros.protein > 70) ||
    (isNumber(macros.carbs) && macros.carbs > 150) ||
    (isNumber(macros.fat) && macros.fat > 50)
  );
}

function buildFactIndex(facts = []) {
  return new Map(
    facts
      .filter((fact) => fact && typeof fact.name === "string")
      .map((fact) => [fact.name.trim().toLowerCase(), fact])
  );
}

function getFactValue(factIndex, factName) {
  const entry = factIndex.get(factName.trim().toLowerCase());
  return entry ? entry.value : null;
}

function getFactLabel(factIndex, factName) {
  const entry = factIndex.get(factName.trim().toLowerCase());
  return entry ? entry.label : null;
}

async function fetchGraphQL(query, variables) {
  const response = await fetch(OFFICIAL_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 PurdueDietOptimizer/0.2"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Official Purdue menu API returned ${response.status}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

function normalizeItem(appearance, context) {
  const item = appearance.item || {};
  const factIndex = buildFactIndex(item.nutritionFacts || []);
  const nutritionVerified = Boolean(item.isNutritionReady && (item.nutritionFacts || []).length);
  const traits = (item.traits || []).map((trait) => ({
    name: trait.name,
    type: trait.type
  }));
  const servingSize = getFactLabel(factIndex, "Serving Size");
  const macros = {
    calories: nutritionVerified ? roundOrNull(getFactValue(factIndex, "Calories")) : null,
    protein: nutritionVerified ? roundOrNull(getFactValue(factIndex, "Protein")) : null,
    carbs: nutritionVerified ? roundOrNull(getFactValue(factIndex, "Total Carbohydrate")) : null,
    fat: nutritionVerified ? roundOrNull(getFactValue(factIndex, "Total fat")) : null
  };

  return {
    name: appearance.displayName || item.name || "Unnamed item",
    specialName: appearance.specialName || null,
    courtName: context.courtName,
    station: context.station,
    meal: context.meal,
    nutritionVerified,
    planningEligible: nutritionVerified && !isSuspiciousServing(servingSize, macros),
    servingSize,
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    fiber: nutritionVerified ? roundOrNull(getFactValue(factIndex, "Dietary Fiber")) : null,
    sodiumMg: nutritionVerified ? roundOrNull(getFactValue(factIndex, "Sodium")) : null,
    ingredients: item.ingredients || null,
    tags: traits.map((trait) => trait.name),
    traits
  };
}

function normalizeCourtMenu(court, requestedDate) {
  const dailyMenu = court.dailyMenu;
  if (!dailyMenu) {
    return [];
  }

  return (dailyMenu.meals || []).map((meal) => ({
    name: court.formalName || court.name,
    meal: meal.name,
    mealType: meal.type,
    status: meal.status,
    requestedDate,
    startTime: meal.startTime,
    endTime: meal.endTime,
    items: (meal.stations || []).flatMap((station) =>
      (station.items || []).map((appearance) =>
        normalizeItem(appearance, {
          courtName: court.formalName || court.name,
          station: station.name,
          meal: meal.name
        })
      )
    )
  }));
}

function buildVerificationSummary(locations) {
  const items = locations.flatMap((location) => location.items || []);
  const verifiedNutritionItems = items.filter((item) => item.nutritionVerified).length;
  const nutritionPendingItems = items.length - verifiedNutritionItems;
  const planningEligibleItems = items.filter((item) => item.planningEligible).length;

  return {
    totalItems: items.length,
    verifiedNutritionItems,
    nutritionPendingItems,
    planningEligibleItems,
    officialNutritionCoverage: items.length ? Number((verifiedNutritionItems / items.length).toFixed(2)) : 0
  };
}

function normalizeMenuOptions(options = {}) {
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(options.date || "")
    ? options.date
    : formatDateInTimezone();

  const requestedCourt = typeof options.courtName === "string" && options.courtName.trim()
    ? options.courtName.trim()
    : "all-residential";

  const requestedCourts = requestedCourt === "all-residential"
    ? RESIDENTIAL_DINING_COURTS
    : [requestedCourt];

  return {
    requestedDate,
    requestedCourt,
    requestedCourts
  };
}

async function fetchCourtMenu(courtName, requestedDate) {
  const data = await fetchGraphQL(DAILY_MENU_QUERY, {
    name: courtName,
    date: requestedDate
  });

  if (!data?.diningCourtByName) {
    throw new Error(`No dining court named "${courtName}" was returned by Purdue's API`);
  }

  return data.diningCourtByName;
}

async function fetchPurdueMenu(options = {}) {
  const normalizedOptions = normalizeMenuOptions(options);
  const settled = await Promise.allSettled(
    normalizedOptions.requestedCourts.map((courtName) =>
      fetchCourtMenu(courtName, normalizedOptions.requestedDate)
    )
  );

  const successfulCourts = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const failedCourts = settled
    .map((result, index) => ({ result, courtName: normalizedOptions.requestedCourts[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, courtName }) => ({
      courtName,
      detail: result.reason instanceof Error ? result.reason.message : String(result.reason)
    }));

  if (!successfulCourts.length) {
    throw new Error(
      failedCourts.length
        ? failedCourts.map((failure) => `${failure.courtName}: ${failure.detail}`).join("; ")
        : "No Purdue dining menu data was returned"
    );
  }

  const locations = successfulCourts.flatMap((court) =>
    normalizeCourtMenu(court, normalizedOptions.requestedDate)
  );
  const verification = buildVerificationSummary(locations);
  const notes = [
    "Food names, stations, ingredients, dietary traits, and nutrition facts come from Purdue Dining's official live API behind Menus Online.",
    "If an item says nutrition pending, the menu listing is official but Purdue has not published verified nutrition facts for that item yet.",
    "The planner automatically skips batch-scale or clearly unrealistic serving sizes when choosing meal recommendations."
  ];

  if (failedCourts.length) {
    notes.push(
      `Some courts could not be loaded from Purdue's live API: ${failedCourts
        .map((failure) => failure.courtName)
        .join(", ")}.`
    );
  }

  const courtNotes = successfulCourts
    .map((court) => court.dailyMenu?.notes)
    .filter(Boolean);

  return {
    source: OFFICIAL_GRAPHQL_URL,
    sourcePage: OFFICIAL_MENU_URL,
    fetchedAt: new Date().toISOString(),
    requestedDate: normalizedOptions.requestedDate,
    requestedCourts: normalizedOptions.requestedCourts,
    timezone: PURDUE_TIMEZONE,
    verification,
    locations,
    notes: [...notes, ...courtNotes],
    failures: failedCourts
  };
}

module.exports = {
  fetchPurdueMenu,
  OFFICIAL_GRAPHQL_URL,
  OFFICIAL_MENU_URL,
  PURDUE_TIMEZONE,
  RESIDENTIAL_DINING_COURTS,
  formatDateInTimezone
};
