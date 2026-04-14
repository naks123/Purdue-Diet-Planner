const GOALS = {
  "fat-loss": { calorieFactor: 12, proteinFactor: 0.95 },
  maintain: { calorieFactor: 14, proteinFactor: 0.85 },
  "lean-bulk": { calorieFactor: 16, proteinFactor: 1.0 }
};

const TRAINING_MULTIPLIER = {
  low: 0.9,
  moderate: 1,
  high: 1.1
};

const SUPPLEMENT_GUIDANCE = {
  creatine: {
    label: "Creatine monohydrate",
    timing: "With breakfast or post-workout",
    dosage: "3-5 g daily",
    caveat: "Avoid doubling up. Hydrate well."
  },
  "vitamin-d": {
    label: "Vitamin D3",
    timing: "With a meal containing fat",
    dosage: "Per lab values or clinician guidance",
    caveat: "Best individualized with bloodwork."
  },
  "omega-3": {
    label: "Omega-3",
    timing: "With lunch or dinner",
    dosage: "Per product label",
    caveat: "Discuss with a clinician if you use blood thinners."
  },
  magnesium: {
    label: "Magnesium glycinate",
    timing: "Evening",
    dosage: "Per product label",
    caveat: "Can interact with some medications."
  },
  caffeine: {
    label: "Caffeine",
    timing: "Early day or pre-workout",
    dosage: "Keep it moderate",
    caveat: "Avoid close to bedtime."
  }
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toMinutes(timeText) {
  const [hours, minutes] = timeText.split(":").map(Number);
  return hours * 60 + minutes;
}

function toClock(totalMinutes) {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const remainder = String(minutes % 60).padStart(2, "0");
  return `${hours}:${remainder}`;
}

function pickItems(items, targetProtein) {
  const sorted = [...items].sort((a, b) => {
    const eligibilityDelta = Number(Boolean(b.planningEligible)) - Number(Boolean(a.planningEligible));
    if (eligibilityDelta) {
      return eligibilityDelta;
    }

    const verificationDelta = Number(Boolean(b.nutritionVerified)) - Number(Boolean(a.nutritionVerified));
    if (verificationDelta) {
      return verificationDelta;
    }

    const densityA = isNumber(a.protein) && isNumber(a.calories) && a.calories > 0 ? a.protein / a.calories : -1;
    const densityB = isNumber(b.protein) && isNumber(b.calories) && b.calories > 0 ? b.protein / b.calories : -1;

    if (densityB !== densityA) {
      return densityB - densityA;
    }

    return (b.protein || -1) - (a.protein || -1);
  });
  const selected = [];
  let totalProtein = 0;

  for (const item of sorted) {
    selected.push(item);
    totalProtein += isNumber(item.protein) ? item.protein : 0;
    if (totalProtein >= targetProtein || selected.length >= 3) {
      break;
    }
  }

  if (!selected.length && sorted.length) {
    return [sorted[0]];
  }

  return selected;
}

function matchesDietaryStyle(profile, item) {
  const style = String(profile.dietaryStyle || "").toLowerCase();
  const tags = new Set((item.tags || []).map((tag) => String(tag).toLowerCase()));

  if (style.includes("vegan")) {
    return tags.has("vegan");
  }

  if (style.includes("vegetarian")) {
    return tags.has("vegetarian");
  }

  return true;
}

function summarizeItems(items) {
  const totals = items.reduce(
    (summary, item) => {
      summary.totalItems += 1;

      if (item.nutritionVerified) {
        summary.verifiedItems += 1;
      } else {
        summary.pendingItems += 1;
      }

      if (isNumber(item.calories)) {
        summary.calories += item.calories;
      }

      if (isNumber(item.protein)) {
        summary.protein += item.protein;
      }

      if (isNumber(item.carbs)) {
        summary.carbs += item.carbs;
      }

      if (isNumber(item.fat)) {
        summary.fat += item.fat;
      }

      return summary;
    },
    {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      totalItems: 0,
      verifiedItems: 0,
      pendingItems: 0
    }
  );

  return {
    ...totals,
    calories: Number(totals.calories.toFixed(1)),
    protein: Number(totals.protein.toFixed(1)),
    carbs: Number(totals.carbs.toFixed(1)),
    fat: Number(totals.fat.toFixed(1)),
    isPartial: totals.pendingItems > 0
  };
}

function compareCourtCandidates(a, b, targetProtein) {
  const aMeetsTarget = a.summary.protein >= targetProtein;
  const bMeetsTarget = b.summary.protein >= targetProtein;

  if (aMeetsTarget !== bMeetsTarget) {
    return Number(bMeetsTarget) - Number(aMeetsTarget);
  }

  if (a.summary.protein !== b.summary.protein) {
    return b.summary.protein - a.summary.protein;
  }

  if (a.summary.pendingItems !== b.summary.pendingItems) {
    return a.summary.pendingItems - b.summary.pendingItems;
  }

  if (a.summary.verifiedItems !== b.summary.verifiedItems) {
    return b.summary.verifiedItems - a.summary.verifiedItems;
  }

  if (a.summary.calories !== b.summary.calories) {
    return a.summary.calories - b.summary.calories;
  }

  return a.courtName.localeCompare(b.courtName);
}

function chooseSingleCourtMeal(items, targetProtein) {
  const itemsByCourt = new Map();

  for (const item of items) {
    const courtName = item.courtName || "Any open court";
    if (!itemsByCourt.has(courtName)) {
      itemsByCourt.set(courtName, []);
    }

    itemsByCourt.get(courtName).push(item);
  }

  const candidates = [...itemsByCourt.entries()].map(([courtName, courtItems]) => {
    const eligiblePool = courtItems.filter((item) => item.planningEligible);
    const verifiedPool = courtItems.filter((item) => item.nutritionVerified);
    const selectionPool = eligiblePool.length ? eligiblePool : verifiedPool.length ? verifiedPool : courtItems;
    const selected = pickItems(selectionPool, targetProtein);

    return {
      courtName,
      items: selected,
      summary: summarizeItems(selected)
    };
  });

  candidates.sort((a, b) => compareCourtCandidates(a, b, targetProtein));
  return candidates[0] || {
    courtName: "Any open court",
    items: [],
    summary: summarizeItems([])
  };
}

function buildMealSlots(profile) {
  const wake = toMinutes(profile.wakeTime);
  const sleep = toMinutes(profile.sleepTime);
  const dayLength = sleep > wake ? sleep - wake : 16 * 60;
  const preferredMeals = new Set(profile.selectedMeals || []);
  const allSlots = [
    { name: "Breakfast", time: toClock(wake + 45), proteinTarget: 35 },
    { name: "Lunch", time: toClock(wake + Math.floor(dayLength * 0.32)), proteinTarget: 40 },
    { name: "Snack", time: toClock(wake + Math.floor(dayLength * 0.52)), proteinTarget: 20 },
    { name: "Dinner", time: toClock(wake + Math.floor(dayLength * 0.72)), proteinTarget: 40 }
  ];

  return allSlots.filter((slot) => preferredMeals.has(slot.name));
}

function calculateHydration(profile) {
  const baseOz = profile.weightLb * 0.5;
  const trainingBonus = profile.trainingLoad === "high" ? 30 : profile.trainingLoad === "moderate" ? 18 : 8;
  const targetOz = Math.round(baseOz + trainingBonus);
  const checkpoints = [
    { label: "Wake-up", time: profile.wakeTime, ounces: Math.round(targetOz * 0.18) },
    { label: "Late morning", time: toClock(toMinutes(profile.wakeTime) + 180), ounces: Math.round(targetOz * 0.22) },
    { label: "Afternoon", time: toClock(toMinutes(profile.wakeTime) + 420), ounces: Math.round(targetOz * 0.28) },
    { label: "Evening", time: toClock(toMinutes(profile.sleepTime) - 150), ounces: Math.round(targetOz * 0.2) }
  ];

  const consumed = checkpoints.reduce((sum, point) => sum + point.ounces, 0);
  checkpoints.push({
    label: "Flex buffer",
    time: "Any time",
    ounces: Math.max(0, targetOz - consumed)
  });

  return {
    targetOz,
    targetLiters: Number((targetOz * 0.0295735).toFixed(1)),
    checkpoints
  };
}

function calculateTargets(profile) {
  const goal = GOALS[profile.goal] || GOALS.maintain;
  const multiplier = TRAINING_MULTIPLIER[profile.trainingLoad] || 1;
  const calories = Math.round(profile.weightLb * goal.calorieFactor * multiplier);
  const protein = Math.round(profile.weightLb * goal.proteinFactor);
  const carbs = Math.round((calories * 0.42) / 4);
  const fat = Math.round((calories * 0.28) / 9);

  return { calories, protein, carbs, fat };
}

function deriveSupplements(profile) {
  return profile.supplements
    .map((key) => SUPPLEMENT_GUIDANCE[key])
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      caution: "Use only if it fits your medical history and current medications."
    }));
}

function menuByMeal(menu) {
  const byMeal = new Map();
  for (const location of menu.locations || []) {
    if (!byMeal.has(location.meal)) {
      byMeal.set(location.meal, []);
    }
    byMeal.get(location.meal).push(...location.items);
  }
  return byMeal;
}

function buildDailyPlan(profile, menu) {
  const targets = calculateTargets(profile);
  const hydration = calculateHydration(profile);
  const supplements = deriveSupplements(profile);
  const slots = buildMealSlots(profile);
  const itemsByMeal = menuByMeal(menu);

  const meals = slots.map((slot) => {
    const matchingItems =
      itemsByMeal.get(slot.name) ||
      itemsByMeal.get("Breakfast") ||
      itemsByMeal.get("Lunch") ||
      itemsByMeal.get("Dinner") ||
      [];

    const filteredItems = matchingItems.filter((item) => matchesDietaryStyle(profile, item));
    const itemPool = filteredItems.length ? filteredItems : matchingItems;
    const courtPlan = chooseSingleCourtMeal(itemPool, slot.proteinTarget);

    return {
      ...slot,
      venue: courtPlan.courtName,
      items: courtPlan.items,
      summary: courtPlan.summary
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    targets,
    hydration,
    supplements,
    meals,
    notes: [
      `Selected meal plan: ${(profile.selectedMeals || []).join(", ")}.`,
      "Each planned meal is assigned to a single dining hall so all recommended items for that meal come from the same court.",
      "This planner uses Purdue's live official menu data for menu names, ingredients, traits, and any nutrition facts Purdue has published.",
      "Meal macro totals only include items with official Purdue nutrition facts; items marked nutrition pending are real menu items with missing verified nutrition.",
      "This planner gives estimated nutrition targets and schedule timing, not medical treatment.",
      "Supplement timing is intentionally conservative and should be personalized with a clinician if you have conditions, prescriptions, or deficiencies.",
      menu.verification?.nutritionPendingItems
        ? `${menu.verification.nutritionPendingItems} menu items are live today but still missing published nutrition facts in Purdue's data.`
        : "All live menu items used today included published Purdue nutrition facts."
    ]
  };
}

function normalizeProfile(input) {
  const weightLb = clamp(Number(input.weightLb) || 175, 90, 350);
  const heightIn = clamp(Number(input.heightIn) || 70, 48, 90);
  const goal = ["fat-loss", "maintain", "lean-bulk"].includes(input.goal) ? input.goal : "maintain";
  const trainingLoad = ["low", "moderate", "high"].includes(input.trainingLoad) ? input.trainingLoad : "moderate";
  const validMeals = ["Breakfast", "Lunch", "Snack", "Dinner"];
  const selectedMeals = Array.isArray(input.selectedMeals) && input.selectedMeals.length
    ? input.selectedMeals.filter((meal) => validMeals.includes(meal))
    : validMeals;

  return {
    name: input.name || "Boilermaker",
    weightLb,
    heightIn,
    goal,
    trainingLoad,
    wakeTime: input.wakeTime || "07:30",
    sleepTime: input.sleepTime || "23:30",
    caffeineCutoff: input.caffeineCutoff || "16:00",
    dietaryStyle: input.dietaryStyle || "high-protein omnivore",
    classBlocks: Array.isArray(input.classBlocks) ? input.classBlocks : [],
    selectedMeals: selectedMeals.length ? selectedMeals : validMeals,
    supplements: Array.isArray(input.supplements) && input.supplements.length
      ? input.supplements
      : ["creatine", "vitamin-d", "omega-3", "magnesium"]
  };
}

module.exports = {
  buildDailyPlan,
  normalizeProfile
};
