import pkg from "@slack/bolt";
const { APP } = pkg;

import { WebClient } from "@slack/web-api";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import express from "express";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

/**
 * Centralized application logger.
 *
 * Provides consistent log formatting across the application and
 * conditionally enables debug output during development to reduce
 * noise in production environments.
 */
const log = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  error: (msg, ...args) => console.log(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) =>
    process.env.NODE_ENV === "developement" &&
    console.log(`[DEBUG] ${msg}`, ...args),
};

/**
 * Slack AI Agent
 *
 * Responsible for:
 * - Initializing Slack and Express clients.
 * - Managing OpenAI integrations.
 * - Listening for Slack workspace events.
 * - Processing new member activity and triggering AI workflows.
 */
class SlackAIAgent {
  /**
   * Initializes all required services and external API clients.
   *
   * Sets up:
   * - Express server
   * - Slack Bolt application
   * - Slack Web API client
   * - OpenAI language model
   *
   * Also registers application routes and event handlers.
   */
  constructor() {
    this.app = express();
    this.slack = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMpde: true,
      appToken: process.env.SLACK_APP_TOKEN,
    });
    this.WebClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.openai = new ChatOpenAI({
      model: "gpt-4",
      temerature: 0.3,
      apiKey: process.env.OPENAI_APY_KEY,
    });

    this.setUpSlackEvents;
    this.setupExpress();
  }

  /**
   * Registers Slack event listeners used by the application.
   *
   * Current events handled:
   * - team_join: Triggered when a user joins the workspace.
   * - member_joined_channel: Triggered when a user joins a public channel.
   *
   * Each event retrieves user information and forwards it to the
   * AI processing pipeline for analysis and posting.
   */
  setUpSlackEvents() {
    this.slack.event("team_join", async ({ event }) => {
      try {
        log.info(
          `New member joined: ${event.user.real_name || event.user.name}`,
        );

        const userInfo = await this.getUserInfo(event.user.id);
        await this.analyzeAndPostMember(userInfo);
      } catch (error) {
        log.error("Error processing team_join: ", error.message);
      }
    });

    this.slack.event("member_joined_channel", async ({ event }) => {
      try {
        if (event.channel_type === "C") {
          log.info(`Member ${event.user} joined channel ${event.channel}`);
          const userInfo = await this.getUserInfo(event.user);
          await this.analyzeAndPostMember(userInfo);
        }
      } catch (error) {
        log.error("Error processing member_joined_channel: ", error.message);
      }
    });
    this.slack.error(async (error) =>
      log.error("Slack error: ", error.message),
    );
  }

  /**
   * Configures Express middleware, health checks, development
   * testing endpoints, and global error handling.
   *
   * Current features:
   * - Parses incoming JSON request bodies.
   * - Exposes a health check endpoint for service monitoring.
   * - Provides a development-only endpoint for testing AI
   *   member analysis without Slack events.
   * - Registers a global error handler for unexpected failures.
   *
   * Development routes:
   * - POST /test/analyze-member: Accepts member data and
   *   triggers the AI analysis pipeline.
   *
   * Production routes:
   * - GET /health: Returns application health status.
   */
  setupExpress() {
    this.app.use(express.json());

    this.app.get("/health", (req, res) => {
      res.json({ status: "healthy", timestamp: new Date().toISOString() });
    });

    if (process.env.NODE_ENV === "development") {
      this.app.post("/test/analyze-member", async (req, res) => {
        try {
          const { memberInfo } = req.body;
          if (!memberInfo)
            return res.status(400).json({ error: "memberInfo is required" });
          const analysis = await this.analyzeAndPostMember(memberInfo);
          res.json({
            success: true,
            analysis,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          log.error("Test analysis error:", error.message);
          res
            .status(500)
            .json({ error: "Analysis failed", message: error.message });
        }
      });
    }

    this.app.use((err, req, res, next) => {
      log.error("Express error", err.message);
      res.status(500).json({ error: "Internal server error" });
    });
  }

  /**
   * Retrieves detailed information for a Slack user by their user ID.
   *
   * Calls the Slack Web API to fetch a user's profile and returns
   * a simplified, normalized object containing commonly used fields
   * such as name, email, title, timezone, and basic profile details.
   *
   * @async
   * @param {string} userId - The Slack user ID to look up.
   * @returns {Promise<Object>} A normalized user object containing:
   *   - id: Slack user ID
   *   - name: User's display name or real name
   *   - username: Slack username
   *   - email: User's email address (if available)
   *   - title: Job title (if available)
   *   - timezone: User's configured timezone
   *   - profile: Basic profile information including first name,
   *     last name, and status text
   */
  async getUserInfo(userId) {
    const result = await this.WebClient.users.info({ user: userId });
    const user = result.user;

    return {
      id: user.id,
      name: user.real_name || user.name,
      username: user.name,
      email: user.profile?.email,
      title: user.profile?.title,
      timezone: user.tz,
      profile: {
        firstName: user.profile?.first_name,
        lastName: user.profile?.last_name,
        statusText: user.profile?.status_text,
      },
    };
  }

  async analyzeAndPostMember() {
    let analysysId = null;
    try {
      log.info(`Processing member: ${memberInfo.name}`);
      const researchData = await this.doBasicResearch(memberInfo);
      const analysis = await this.analyzeWithAI(memberInfo, researchData);
      log.info(`Saving analysis to database for ${memberInfo.name}`);
      analysisId = await saveMemberAnalysis(memberInfo, analysis, researchData);

      await this.postAnalysisToChannel(memberInfo, analysis, researchData);

      if (analysis) {
        await markAsSentToSlack(analysysId);
      }
    } catch (error) {
      log.error(`Error processing ${memberInfo}: `, error.message);
      if (analysysId) {
        log.info(
          `Analysus ${analysis} saved to database but not send to Slack due to error`,
        );
      }
      throw error;
    }
  }
}
