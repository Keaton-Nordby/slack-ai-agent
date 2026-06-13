import pkg from "@slack/bolt";
const { App } = pkg;

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
    process.env.NODE_ENV === "development" &&
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
      socketMode: true,
      appToken: process.env.SLACK_APP_TOKEN,
    });
    this.WebClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.openai = new ChatOpenAI({
      model: "gpt-4",
      temperature: 0.3,
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.setUpSlackEvents();
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

    this.app.use((err, req, res, _next) => {
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

  /**
   * Orchestrates the complete member analysis workflow.
   *
   * This function performs basic research on a member, generates an AI-powered
   * analysis, persists the results to the database, posts the analysis to Slack,
   * and updates the record to indicate successful delivery. Comprehensive error
   * handling ensures failures are logged and partially completed operations can
   * be identified for troubleshooting or retry.
   *
   * @async
   * @returns {Promise<void>} Resolves when the member has been fully processed.
   * @throws {Error} Propagates any error encountered during research, analysis,
   * persistence, or Slack notification.
   */
  async analyzeAndPostMember(memberInfo) {
    let analysisId = null;
    try {
      log.info(`Processing member: ${memberInfo.name}`);
      const researchData = await this.doBasicResearch(memberInfo);
      const analysis = await this.analyzeWithAI(memberInfo, researchData);
      log.info(`Saving analysis to database for ${memberInfo.name}`);
      analysisId = await saveMemberAnalysis(memberInfo, analysis, researchData);

      await this.postAnalysisToChannel(memberInfo, analysis, researchData);

      if (analysisId) {
        await markAsSentToSlack(analysisId);
      }
    } catch (error) {
      log.error(`Error processing ${memberInfo.name}: `, error.message);
      if (analysisId) {
        log.info(
          `Analysis ${analysisId} saved to database but not sent to Slack due to an error.`,
        );
      }
      throw error;
    }
  }

  /**
   * Performs basic enrichment research for a member using available public signals.
   *
   * This function gathers lightweight contextual data about a member to support
   * downstream AI analysis. It attempts to enrich the member profile using:
   * - Company information derived from the email domain (if available and not personal email)
   * - GitHub profile information based on the member’s name
   *
   * The function is intentionally non-blocking and best-effort:
   * failures in external lookups are caught and logged without interrupting execution.
   *
   * @async
   * @function doBasicResearch
   * @returns {Promise<Array>} Array of collected enrichment data (e.g., company info, GitHub info)
   */
  async doBasicResearch(memberInfo) {
    const results = [];

    try {
      if (memberInfo.email && !this.isPersonalEmail(memberInfo.email)) {
        const domain = memberInfo.email.split("@")[1];
        const companyInfo = await this.getCompanyInfo(domain);
        if (companyInfo) results.push(companyInfo);

        if (memberInfo.name) {
          const githubInfo = await this.getGitHubInfo(memberInfo.name);
          if (githubInfo) results.push(githubInfo);
        }
      }
    } catch (error) {
      log.error("Research error: ", error.message);
    }
    return results;
  }

  /**
   * Attempts to fetch basic metadata about a company website using its domain.
   *
   * This function performs a simple HTTP request to the provided domain,
   * extracts the HTML <title> tag, and returns a lightweight company object.
   * If the request fails (timeout, invalid domain, or network error),
   * it logs the error and returns null.
   *
   * NOTE:
   * This is a best-effort scraper and not a reliable business intelligence API.
   *
   * @param {string} domain - The company domain (e.g., "openai.com")
   * @returns {Promise<Object|null>} Simplified company metadata object or null if fetch fails
   */
  async getCompanyInfo(domain) {
    try {
      const response = await axios.get(`https://www.${domain}`, {
        timeout: 5000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      const titleMatch = response.data.match(/<title>(.*?)<\/title/i);
      const title = titleMatch ? titleMatch[1] : `Company: ${domain}`;

      return {
        url: `https://www.${domain}`,
        title: title,
        content: `Company website for ${domain}`,
        type: "company",
      };
    } catch (error) {
      log.error(`Could not fetch ${domain}: `, error.message);
      return null;
    }
  }

  /**
   * Searches GitHub users by name and returns basic profile information
   * for the best matching user.
   *
   * This function uses the GitHub Search API to find users matching the
   * provided query string and returns a simplified profile of the first result.
   * If no users are found or the request fails, it returns null.
   *
   * @param {string} name - Username or search term for GitHub user lookup
   * @returns {Promise<Object|null>} Simplified GitHub user info or null if not found
   */
  async getGitHubInfo(name) {
    try {
      const response = await axios.get(
        `https://api.github.com/search/users?q=${encodeURIComponent(name)}`,
        { timeout: 5000 },
      );

      if (response.data.items && response.data.items.length > 0) {
        const user = response.data.items[0];
        return {
          url: user.html_url,
          title: `GitHub: ${user.login}`,
          content: `${user.public_repos} public repositories`,
          type: "github",
        };
      }
    } catch (error) {
      log.debug("GitHub search error: ", error.message);
    }
    return null;
  }

  /**
   * Analyzes a community member's profile and research data using an AI model
   * to estimate product fit and generate engagement recommendations.
   *
   * Builds a structured prompt containing member information and external
   * research, sends it to the configured LLM, and parses the JSON response
   * into a standardized format. Includes validation and fallback defaults
   * to ensure reliable output even if the AI response is incomplete.
   *
   * @async
   * @param {Object} memberInfo - Basic information about the community member.
   * @param {string} memberInfo.name - Member's full name.
   * @param {string} [memberInfo.email] - Member's email address.
   * @param {string} [memberInfo.title] - Member's job title.
   * @param {Array<Object>} researchData - Collected research about the member.
   * @returns {Promise<Object>} AI-generated member analysis.
   * @returns {number} returns.fitScore - Product fit score (0-100).
   * @returns {string[]} returns.insights - Key observations about the member.
   * @returns {string[]} returns.recommendations - Suggested engagement strategies.
   *
   * @throws Does not propagate errors. Returns a default analysis object
   * if AI generation or JSON parsing fails.
   */
  async analyzeWithAI(memberInfo, researchData) {
    const prompt = ChatPromptTemplate.fromTemplate(
      `Analyze this new community member for fit with our commercial 
    product.

    Company: ${process.env.COMPANY_NAME || "Your Company"}
    Product: ${process.env.COMPANY_PRODUCT || "Your Product"}

    Member:
    - Name: {name}
    - Email: {email}
    - Title: {title}

    Research Data:
    {research}

    Provide a JSON response with:
    - fitScore (0-100): likelihood they'd be interested in our product
    - insights: array of 3-5 key observations
    - recommendations: array of 2-4 engagement suggestions

    Consider job title, company size, technical background, and budget 
    authority.`,
    );

    try {
      const researchSummary =
        researchData.length > 0
          ? researchData.map((r) => `${r.title}: ${r.content}`).join(`\\n`)
          : "Limited research data available";

      const chain = prompt.pipe(this.openai);
      const result = await chain.invoke({
        name: memberInfo.name,
        email: memberInfo.email || "Not provided",
        title: memberInfo.title || "Not provided",
        research: researchSummary,
      });

      const responseText = result.content || result;
      const cleanedResponse = responseText
        .replace(/```json\n?|\n?```/g, "")
        .trim();

      const analysis = JSON.parse(cleanedResponse);

      return {
        fitScore: Math.max(0, Math.min(100, analysis.fitScore || 50)),
        insights: Array.isArray(analysis.insights)
          ? analysis.insights
          : ["Analysis completed"],
        recommendations: Array.isArray(analysis.recommendations)
          ? analysis.recommendations
          : ["Follow up recommended"],
      };
    } catch (error) {
      log.error("AI analysis error: ", error.message);
      return {
        fitScore: 50,
        insights: ["unable to complete full analysis"],
        recommendations: ["Manual review recommended"],
      };
    }
  }

  /**
   * Formats and posts an AI-generated member analysis to a private Slack
   * channel using Block Kit components.
   *
   * Creates a color-coded summary based on the member's fit score,
   * includes contact information, AI-generated insights, and recommended
   * engagement strategies, then sends the formatted message to Slack.
   *
   * @async
   * @param {Object} member - Information about the community member.
   * @param {string} member.name - Member's full name.
   * @param {string} [member.email] - Member's email address.
   * @param {string} [member.title] - Member's job title.
   * @param {Object} analysis - AI-generated member analysis.
   * @param {number} analysis.fitScore - Product fit score (0-100).
   * @param {string[]} analysis.insights - Key observations about the member.
   * @param {string[]} analysis.recommendations - Suggested engagement actions.
   * @param {Array<Object>} researchData - Research collected for the member.
   * @returns {Promise<void>}
   *
   * @throws Propagates Slack API errors if the message cannot be delivered.
   */
  async postAnalysisToChannel(member, analysis, researchData) {
    const color =
      analysis.fitScore >= 80
        ? "#36a64f"
        : analysis.fitScore >= 60
          ? "#ffb84d"
          : analysis.fitScore >= 40
            ? "#ff9500"
            : "#ff4444";

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `New Member: ${member.name}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Fit Score:* ${analysis.fitScore}/100` },
          {
            type: "mrkdwn",
            text: `*Email:* ${member.email || "Not provided"}`,
          },
          {
            type: "mrkdwn",
            text: `*Title:* ${member.title || "Not provided"}`,
          },
        ],
      },
    ];

    if (analysis.insights.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Insights:*\n${analysis.insights
            .map((i) => `• ${i}`)
            .join("\n")}`,
        },
      });
    }

    if (analysis.recommendations.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Recommendations:*\n${analysis.recommendations
            .map((i) => `• ${i}`)
            .join("\n")}`,
        },
      });
    }

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Analyzed: ${new Date().toISOString()}`,
        },
      ],
    });

    await this.WebClient.chat.postMessage({
      channel: process.env.SLACK_PRIVATE_CHANNEL_ID,
      text: `New Member Analysis: ${member.name} (${analysis.fitScore}/100)`,
      attachments: [
        {
          color: color,
          blocks: blocks,
        },
      ],
    });
    log.info(`Analysis posted to channel for ${member.name}`);
  }

  /**
   * Determines whether an email address belongs to a common personal
   * email provider rather than a business domain.
   *
   * Used to help distinguish individual contacts from corporate
   * identities during member analysis and qualification.
   *
   * @param {string} email - Email address to evaluate.
   * @returns {boolean} True if the email uses a recognized personal
   * provider; otherwise, false.
   */
  isPersonalEmail(email) {
    const personalDomains = [
      "gmail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "icloud.com",
    ];
    const domain = email.split("@")[1]?.toLowerCase();
    return personalDomains.includes(domain);
  }

  /**
   * Starts the Slack AI Agent and all required application services.
   *
   * Performs application startup in the following order:
   * - Initializes the database connection.
   * - Starts the Express web server.
   * - Connects the Slack Bolt application.
   * - Logs application status and available development endpoints.
   *
   * If any startup step fails, the error is logged and the
   * application exits with a non-zero status code.
   *
   * @async
   * @returns {Promise<void>}
   * @throws Does not propagate errors. Terminates the process if
   * initialization fails.
   */
  async start() {
    try {
      log.info("Starting Slack AI Agent...");

      log.info("Initializing database...");
      await initDatabase();

      const port = process.env.PORT || 3000;

      log.info(`Starting Express server on port ${port}...`);
      this.server = this.app.listen(port, () => {
        log.info(`Express server listening on port ${port}`);
      });

      log.info("Connecting to Slack...");
      await this.slack.start();
      log.info("Slack bot connected");

      log.info("Slack AI Agent started successfully");

      if (process.env.NODE_ENV === "development") {
        log.info(
          `Test endpoint: POST http://localhost:${port}/test/analyze-member`,
        );
      }
    } catch (error) {
      log.error("Failed to start:", error.message);
      process.exit(1);
    }
  }
  /**
   * Gracefully shuts down the Slack AI Agent and associated services.
   *
   * Performs an orderly shutdown by:
   * - Disconnecting the Slack client.
   * - Closing the Express server.
   * - Closing the database connection.
   *
   * Any shutdown errors are logged before the application exits.
   *
   * @async
   * @returns {Promise<void>}
   */
  async stop() {
    log.info("Shutting down Slack AI Agent...");

    try {
      await this.slack.stop();

      if (this.server) {
        await new Promise((resolve) => this.server.close(resolve));
      }

      await closeDatabase();

      log.info("Slack AI Agent stopped successfully");
    } catch (error) {
      log.error("Shutdown error:", error.message);
    }

    process.exit(0);
  }
}

const agent = new SlackAIAgent();

process.on("SIGINT", () => agent.stop());
process.on("SIGTERM", () => agent.stop());

agent.start().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});

export default agent;
