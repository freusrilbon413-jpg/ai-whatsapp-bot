app.post("/api/webhook/evolution", async (req, res) => {
  console.log("🔥 WEBHOOK RECEIVED:", JSON.stringify(req.body));

  res.status(200).json({
    received: true,
  });

  // rès kòd webhook la...
});
