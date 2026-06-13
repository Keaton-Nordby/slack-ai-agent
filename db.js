import pg from "pg";
const { Pool } = pg;
import dotenv from "dotenv";

dotenv.config();

/**
 * PostgreSQL connection pool.
 *
 * Manages database connections efficiently with pooling,
 * timeouts, and SSL configuration for production environments.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/**
 * Logs successful database connection events.
 */
pool.on("connect", () => {
  console.log("[INFO] Database connected");
});

/**
 * Handles unexpected pool-level database errors.
 */
pool.on("error", (err) => {
  console.log("[ERROR] Unexpected database error:", err.message);
});

/**
 * Initializes database schema required for member analysis storage.
 *
 * Creates:
 * - member_analyses table (if not exists)
 * - indexes for faster query performance
 *
 * Safe to run multiple times (idempotent).
 *
 * @async
 */
export async function initDatabase() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS member_analyses (
        id SERIAL PRIMARY KEY,
        member_id VARCHAR(255),
        member_name VARCHAR(255) NOT NULL,
        member_email VARCHAR(255),
        member_title VARCHAR(255),
        member_timezone VARCHAR(100),
        fit_score INTEGER NOT NULL,
        insights JSONB,
        recommendations JSONB,
        research_data JSONB,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_to_slack BOOLEAN DEFAULT FALSE,
        sent_to_slack_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_member_id 
      ON member_analyses(member_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analyzed_at 
      ON member_analyses(analyzed_at);
    `);

    console.log("[INFO] Database schema initialized");
  } catch (error) {
    console.log(
      "[ERROR] Unexpected database initialization error:",
      error.message,
    );
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Saves an AI-generated member analysis to the database.
 *
 * Stores:
 * - Member identity info
 * - AI fit score
 * - insights + recommendations (JSONB)
 * - raw research data
 *
 * @async
 * @returns {number} Inserted row ID
 */
export async function saveMemberAnalysis(memberInfo, analysis, researchData) {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      INSERT INTO member_analyses (
        member_id, 
        member_name, 
        member_email, 
        member_title, 
        member_timezone,
        fit_score, 
        insights, 
        recommendations, 
        research_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
      `,
      [
        memberInfo.id || null,
        memberInfo.name,
        memberInfo.email || null,
        memberInfo.title || null,
        memberInfo.timezone || null,
        analysis.fitScore,
        JSON.stringify(analysis.insights),
        JSON.stringify(analysis.recommendations),
        JSON.stringify(researchData),
      ],
    );

    const id = result.rows[0].id;

    console.log(`[INFO] Saved analysis to database (ID: ${id})`);
    return id;
  } catch (error) {
    console.log("[ERROR] Failed to save analysis:", error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Marks a stored analysis as successfully sent to Slack.
 *
 * Updates tracking fields:
 * - sent_to_slack = true
 * - sent_to_slack_at timestamp
 *
 * @async
 * @param {number} analysisId
 */
export async function markAsSentToSlack(analysisId) {
  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE member_analyses
      SET sent_to_slack = TRUE,
          sent_to_slack_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [analysisId],
    );
  } catch (error) {
    console.log("[ERROR] Failed to mark as sent to Slack:", error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Gracefully closes the PostgreSQL connection pool.
 *
 * Should be called during application shutdown.
 */
export async function closeDatabase() {
  await pool.end();
  console.log("[INFO] Database connection pool closed");
}

export default pool;
