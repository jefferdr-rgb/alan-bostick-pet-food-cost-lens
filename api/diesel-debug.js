const {
  fetchDieselSeries,
  fetchEiaDailyDiesel,
  fetchEiaWeeklyDiesel,
  fetchFredWeeklyDiesel,
  inspectSource,
  json,
} = require("./diesel");

module.exports = async function handler(req, res) {
  const [eiaDaily, eiaWeekly, fredWeekly, series] = await Promise.all([
    inspectSource("eia-daily-aaa", fetchEiaDailyDiesel),
    inspectSource("eia-weekly", fetchEiaWeeklyDiesel),
    inspectSource("fred-weekly", fetchFredWeeklyDiesel),
    inspectSource("selected-series", fetchDieselSeries),
  ]);

  json(res, 200, {
    updatedAt: new Date().toISOString(),
    sources: [eiaDaily, eiaWeekly, fredWeekly, series],
  });
};
