🚀 Slack AI Agent

An AI-powered Slack bot that automatically analyzes new community members, enriches their profile data, and generates intelligent sales/engagement insights using OpenAI. The system stores results in a database and posts structured summaries back into Slack using Block Kit.

✨ Features
 Detects new Slack members (team_join, member_joined_channel)
 AI-powered member analysis (fit score, insights, recommendations)
 Lightweight enrichment (GitHub + company domain scraping)
 PostgreSQL persistence layer for analysis tracking
 Auto-posts structured reports into Slack channels Robust error handling with fallback analysis pipeline
 Local test endpoint for development workflow
🏗️ Architecture Overview
Slack Event
   ↓
Bolt Listener (team_join / member_joined_channel)
   ↓
getUserInfo()
   ↓
doBasicResearch()
   ├── GitHub API lookup
   └── Company domain scrape
   ↓
analyzeWithAI() (LangChain + OpenAI)
   ↓
saveMemberAnalysis() (Postgres)
   ↓
postAnalysisToChannel() (Slack Web API)
⚙️ Tech Stack
Node.js (ESM)
Express.js
Slack Bolt SDK
Slack Web API
LangChain
OpenAI GPT-4 / GPT-4o
PostgreSQL
Axios
📦 Installation
git clone https://github.com/yourusername/slack-ai-agent.git
cd slack-ai-agent
npm install
🔐 Environment Variables

Create a .env file:

SLACK_BOT_TOKEN=your-token
SLACK_SIGNING_SECRET=your-secret
SLACK_APP_TOKEN=your-app-token

OPENAI_API_KEY=your-openai-key

DATABASE_URL=your-postgres-url

SLACK_PRIVATE_CHANNEL_ID=your-channel-id

COMPANY_NAME=Your Company
COMPANY_PRODUCT=Your Product

NODE_ENV=development
PORT=3000
▶️ Running the Project
npm run dev

Server runs at:

http://localhost:3000
🧪 Test Endpoint

You can manually trigger analysis:

curl -X POST http://localhost:3000/test/analyze-member \
  -H "Content-Type: application/json" \
  -d '{
    "memberInfo": {
      "name": "john doe",
      "email": "john@techcorp.com",
      "title": "senior software engineer"
    }
  }'
📊 Example Output
{
  "fitScore": 78,
  "insights": [
    "Strong technical background in software engineering",
    "Likely familiar with scalable backend systems"
  ],
  "recommendations": [
    "Offer technical deep-dive demo",
    "Highlight engineering-focused features"
  ]
}

💬 Slack Output Example
Fit Score card (0–100)
Email + Title
AI Insights
Engagement Recommendations
Timestamped audit trail

⚠️ Known Issues / Notes
Bot must be invited to Slack channels before posting
GitHub + scraping enrichment is best-effort only
OpenAI responses are strictly validated JSON (fallback enabled)

🧠 Key Design Decisions
Fail-safe pipeline (each stage isolated)
AI output strictly validated before usage
Lightweight enrichment instead of heavy data pipelines
Slack Block Kit for structured UI output
Test endpoint for fast local iteration

🙌 Credits
Built following concepts and inspiration from:
Code with Ania Kubów — for backend + API + AI integration patterns
freeCodeCamp — for foundational backend, Node.js, and system design learning 

🚀 Future Improvements
Deduping system for repeated users
Redis queue for scalable event handling
Dashboard for viewing analyzed members
Better enrichment (LinkedIn, Clearbit, etc.)
Role-based scoring models
