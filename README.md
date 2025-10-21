# Estimatix - AI-Assisted Contractor Estimating

A modern, mobile-first PWA for contractors to generate accurate project estimates through voice recording powered by AI.

## Features

- 🎤 Voice-to-text recording for project descriptions
- 🤖 AI-powered estimate generation
- 📱 Mobile-first, responsive design
- 🎨 Clean, professional SaaS interface
- ♿ Keyboard navigation and accessibility support
- 📊 Detailed estimate breakdowns with export options

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **UI Components:** shadcn/ui
- **Icons:** Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. Clone the repository
2. Install dependencies:

\`\`\`bash
npm install
\`\`\`

3. Run the development server:

\`\`\`bash
npm run dev
\`\`\`

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

\`\`\`
├── app/
│   ├── page.tsx              # Landing page
│   ├── dashboard/page.tsx    # Projects dashboard
│   ├── record/page.tsx       # Voice recording interface
│   ├── layout.tsx            # Root layout
│   └── globals.css           # Global styles
├── components/
│   ├── navbar.tsx            # Marketing navbar
│   ├── footer.tsx            # Footer component
│   ├── sidebar.tsx           # Dashboard sidebar
│   ├── recording-interface.tsx # Recording UI
│   └── ui/                   # shadcn/ui components
└── public/
    └── manifest.json         # PWA manifest
\`\`\`

## TODO: Backend Integration

The following features require backend implementation:

### Authentication
- [ ] Implement Supabase authentication
- [ ] Add login/signup pages
- [ ] Protect dashboard and record routes
- [ ] Add user session management

### Database (Supabase)
- [ ] Create projects table schema
- [ ] Create estimates table schema
- [ ] Implement CRUD operations for projects
- [ ] Add user-project relationships

### AI Integration
- [ ] Set up AI SDK for estimate generation
- [ ] Create `/api/generate-estimate` endpoint
- [ ] Implement voice-to-text with Web Speech API
- [ ] Add AI model for parsing construction data

### PWA Features
- [ ] Create service worker for offline support
- [ ] Add app icons (192x192, 512x512)
- [ ] Implement caching strategy
- [ ] Add install prompt

### Additional Features
- [ ] PDF export functionality
- [ ] Excel export functionality
- [ ] Email estimates to clients
- [ ] Project templates
- [ ] Cost database integration

## Accessibility

This app follows WCAG 2.1 Level AA guidelines:

- Semantic HTML elements
- ARIA labels and roles
- Keyboard navigation support
- Screen reader friendly
- Sufficient color contrast

## License

MIT
