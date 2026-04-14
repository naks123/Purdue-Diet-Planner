function formatNumber(value, digits = 0) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0";
  }

  return value.toFixed(digits).replace(/\.0$/, "");
}

function formatPurdueDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Indiana/Indianapolis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatMacroSummary(summary) {
  const suffix = summary.isPartial ? " · partial nutrition" : " · verified";
  return `${formatNumber(summary.calories)} kcal · ${formatNumber(summary.protein, 1)}P · ${formatNumber(summary.carbs, 1)}C · ${formatNumber(summary.fat, 1)}F${suffix}`;
}

function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function renderHeroMetrics(plan, menu) {
  const target = document.getElementById("heroMetrics");
  target.innerHTML = "";

  [
    { label: "Daily calories", value: `${plan.targets.calories}` },
    { label: "Protein target", value: `${plan.targets.protein} g` },
    { label: "Hydration target", value: `${plan.hydration.targetLiters} L` },
    { label: "Official nutrition", value: `${Math.round((menu.verification?.officialNutritionCoverage || 0) * 100)}%` }
  ].forEach((metric) => {
    const chip = document.createElement("div");
    chip.className = "metric-chip";
    chip.innerHTML = `<span>${metric.label}</span><strong>${metric.value}</strong>`;
    target.appendChild(chip);
  });
}

function renderSnapshot(plan, menu) {
  const root = document.getElementById("snapshot");
  root.innerHTML = `
    <div class="section-head">
      <h2>Daily snapshot</h2>
      <p>Generated ${new Date(plan.generatedAt).toLocaleString()}</p>
    </div>
    <div class="snapshot-grid">
      <div class="stat-card">
        <div class="label">Calories</div>
        <div class="value">${plan.targets.calories}</div>
      </div>
      <div class="stat-card">
        <div class="label">Protein</div>
        <div class="value">${plan.targets.protein}g</div>
      </div>
      <div class="stat-card">
        <div class="label">Carbs</div>
        <div class="value">${plan.targets.carbs}g</div>
      </div>
      <div class="stat-card">
        <div class="label">Fat</div>
        <div class="value">${plan.targets.fat}g</div>
      </div>
      <div class="stat-card">
        <div class="label">Verified foods</div>
        <div class="value">${menu.verification?.verifiedNutritionItems || 0}</div>
      </div>
      <div class="stat-card">
        <div class="label">Nutrition pending</div>
        <div class="value">${menu.verification?.nutritionPendingItems || 0}</div>
      </div>
    </div>
  `;
}

function renderMeals(plan) {
  const root = document.getElementById("mealSchedule");
  root.innerHTML = "";

  plan.meals.forEach((meal) => {
    const card = document.createElement("article");
    card.className = "meal-card";
    card.innerHTML = `
      <div class="meal-head">
        <div>
          <h3>${meal.name}</h3>
          <div class="meal-meta">${meal.time} · ${meal.venue}</div>
        </div>
        <div class="summary-line">${formatMacroSummary(meal.summary)}</div>
      </div>
      <div class="meal-meta">${meal.summary.verifiedItems}/${meal.summary.totalItems} selected items have official Purdue nutrition facts.</div>
      <div class="meal-items">
        ${meal.items
          .map(
            (item) => `
              <div class="meal-item">
                <div>
                  <strong>${item.name}</strong>
                  <div class="item-tags">${[item.courtName, item.station, item.servingSize, ...(item.tags || [])].filter(Boolean).join(" · ") || "menu item"}</div>
                </div>
                <div>${item.nutritionVerified ? `${formatNumber(item.protein, 1)}g protein · ${formatNumber(item.calories)} kcal` : "Nutrition pending"}</div>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    root.appendChild(card);
  });
}

function renderHydration(plan) {
  const root = document.getElementById("hydrationPlan");
  root.innerHTML = `
    <div class="list-card">
      <h3>${plan.hydration.targetOz} oz total</h3>
      <ul class="hydration-list">
        ${plan.hydration.checkpoints
          .map((point) => `<li>${point.label}: ${point.ounces} oz by ${point.time}</li>`)
          .join("")}
      </ul>
    </div>
  `;
}

function renderSupplements(plan) {
  const root = document.getElementById("supplementPlan");
  root.innerHTML = `
    <div class="list-card">
      <h3>${plan.supplements.length} items scheduled</h3>
      <ul class="supplement-list">
        ${plan.supplements
          .map(
            (entry) => `
              <li>
                <strong>${entry.label}</strong>: ${entry.timing}, ${entry.dosage}
                <div class="caveat">${entry.caveat} ${entry.caution}</div>
              </li>
            `
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderNotes(plan, menu) {
  const root = document.getElementById("plannerNotes");
  root.innerHTML = [...new Set([...(menu.notes || []), ...(plan.notes || [])])]
    .map((note) => `<li>${note}</li>`)
    .join("");

  const source = document.getElementById("menuSource");
  source.textContent = `Live source: Purdue Dining official API · ${menu.requestedDate} · ${menu.requestedCourts.join(", ")}`;
}

function formToPayload(form) {
  const values = Object.fromEntries(new FormData(form).entries());

  return {
    profile: {
      name: values.name,
      goal: values.goal,
      weightLb: values.weightLb,
      heightIn: values.heightIn,
      wakeTime: values.wakeTime,
      sleepTime: values.sleepTime,
      trainingLoad: values.trainingLoad,
      dietaryStyle: values.dietaryStyle,
      selectedMeals: checkedValues(form, "selectedMeals"),
      supplements: checkedValues(form, "supplements")
    },
    menuOptions: {
      date: values.menuDate,
      courtName: values.courtName
    }
  };
}

async function generatePlan(payload) {
  const response = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const failure = await response.json();
    throw new Error(failure.detail || failure.error || "Plan generation failed");
  }

  return response.json();
}

function renderAll(payload) {
  renderHeroMetrics(payload.plan, payload.menu);
  renderSnapshot(payload.plan, payload.menu);
  renderMeals(payload.plan);
  renderHydration(payload.plan);
  renderSupplements(payload.plan);
  renderNotes(payload.plan, payload.menu);
}

async function bootstrap() {
  const form = document.getElementById("plannerForm");
  const dateInput = form.querySelector("input[name='menuDate']");

  if (!dateInput.value) {
    dateInput.value = formatPurdueDate();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "Rebuilding...";

    try {
      const payload = await generatePlan(formToPayload(form));
      renderAll(payload);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Generate Today’s Plan";
    }
  });

  const response = await fetch("/api/demo");
  const payload = await response.json();
  renderAll(payload);
}

bootstrap().catch((error) => {
  console.error(error);
});
