async function createTempPlan() {
  const body = {
    email: '2001leety@gmail.com',
    adults: 2,
    arrival_airport: 'ICN_T1',
    departure_airport: 'ICN_T1',
    styles: ['food'],
    allergies: [],
    paypalOrderId: `ADMIN-BYPASS-VALIDATE-temp-${Date.now()}`,
    guestName: 'E2E Test',
    pax: 2,
    area: 'Seoul',
    duration: '1day',
    startDate: '2026-05-15',
    language: 'en'
  };

  const resp = await fetch('https://cocotripkr.com/api/ai-planner-full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error('Failed', await resp.text());
    return;
  }
  const data = await resp.json();
  console.log('Created planId:', data.planId);
  // We can write it to a file that E2E test reads
  require('fs').writeFileSync('temp_plan_id.txt', data.planId);
}
createTempPlan();
