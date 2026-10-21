# ApplyPilot AI — Complete Product Specification, System Architecture, Agent Harness, and Implementation Blueprint

## 1. Project Overview

### 1.1 Product Name

**ApplyPilot AI**

Tagline: *One click. Every application. Less repetitive work.*

Product category: Personal AI browser automation agent for job applications, resume tailoring, and application workflow management.

### 1.2 Product Vision

ApplyPilot AI is a personal, intelligent browser extension that automates repetitive job application workflows across a wide range of websites.

The user should be able to open a job application page, click a single **Quick Apply** button inside the extension, and let the system handle the rest.

The agent must be capable of:

- Understanding the currently open webpage.
- Identifying the job being applied for.
- Extracting the job description and employer information.
- Understanding the structure and meaning of the application form.
- Retrieving relevant information from the user's saved profile.
- Filling standard fields without requiring the user to click each field.
- Answering open-ended questions using the user's actual experience.
- Tailoring a resume to the current job description.
- Selecting an appropriate resume variant.
- Uploading the selected resume when the website supports a safe, permitted upload workflow.
- Navigating through multi-step application forms.
- Detecting validation errors and correcting recoverable failures.
- Verifying that the correct information was entered.
- Remembering successful interaction patterns for future visits.
- Pausing when information is missing, ambiguous, sensitive, or requires human verification.

The system must work on common job portals through optimized integrations and attempt to operate on unfamiliar portals through a general-purpose browser agent.

The objective is not to create another extension that supports a fixed list of websites. The objective is to create an adaptable browser automation system that can understand unfamiliar web forms and interact with them intelligently.

### 1.3 Core Product Philosophy

The product must follow these principles:

1. **One-click initiation:** The user initiates an application workflow once rather than interacting with individual fields.
2. **Automation-first:** The agent performs all safe, supported actions autonomously.
3. **Rules before AI:** Use deterministic logic whenever possible and AI only when semantic interpretation or generation is required.
4. **Profile-grounded answers:** Never invent personal facts, qualifications, employment history, achievements, or metrics.
5. **Universal-by-design:** Use a general-purpose agent for unknown portals rather than requiring a developer to add every website manually.
6. **Continuous verification:** Never assume that an action succeeded merely because it was attempted.
7. **Learning from experience:** Store successful, reusable portal interaction strategies.
8. **Privacy-first:** Keep personal data and application history under the user's control.
9. **Human control over consequential actions:** The agent can prepare and complete supported forms but must not submit applications without explicit user approval.
10. **Graceful degradation:** When a website cannot be automated reliably, explain the blocker and preserve completed work instead of silently failing.

---

# 2. Target User and Primary Use Case

The initial product is designed for one user: the owner of the browser extension.

The extension is not initially intended to be a public SaaS platform with multiple accounts, shared API credentials, teams, or centralized storage.

The user is a student or early-career applicant applying to internships, graduate positions, research opportunities, and entry-level jobs across multiple companies.

The user may encounter application portals operated by:

- Workday
- Greenhouse
- Lever
- Ashby
- SmartRecruiters
- iCIMS
- Taleo
- Oracle Recruiting
- SAP SuccessFactors
- Company-specific recruitment websites
- University and research application portals
- Smaller applicant tracking systems
- Custom forms embedded in company websites
- Previously unseen recruitment platforms

These are examples of target environments, not a promise that every version or configuration will be supported perfectly.

The system must not depend on any one of these websites.

## Primary user journey

1. The user opens a job listing or application page.
2. The user clicks the ApplyPilot AI extension icon.
3. The extension displays a **Quick Apply** action.
4. The user clicks Quick Apply.
5. The agent inspects the current page and discovers the job description, employer, application fields, and current application stage.
6. The agent retrieves the user's profile, relevant resume, saved preferences, and verified answers.
7. The agent selects an appropriate execution strategy.
8. The agent fills supported fields automatically.
9. The agent generates job-specific answers where required.
10. The agent handles supported dropdowns, autocomplete fields, checkboxes, conditional questions, and multi-step navigation.
11. The agent verifies its work after each meaningful group of actions.
12. The agent pauses before final submission and displays a concise completion report.
13. The user reviews and submits the application manually.

**The user must not need to click individual form fields, explain what each field means, or manually copy answers between the extension and the webpage.**

A click to initiate the process is acceptable. Repeated clicks to assist ordinary form filling are not.

---

# 3. Scope and Non-Goals

## 3.1 Included in the Initial Product

- Chrome browser extension.
- React-based extension interface.
- Local personal profile management.
- Resume upload, parsing, and storage.
- Job description extraction.
- Universal form-field discovery.
- Semantic field mapping.
- Automatic form filling.
- AI-generated job-specific answers.
- Resume tailoring and variant management.
- Multi-step application handling.
- Supported file uploads.
- Automatic validation and recovery.
- Portal adapter system.
- Local interaction memory.
- Gemini and Groq provider support.
- AI usage tracking.
- Application history.
- Human review before submission.
- Error logging and debugging.
- Automated testing.

## 3.2 Explicitly Out of Scope for the First Version

- Automatically submitting applications without approval.
- Automatically accepting legal declarations or binding agreements.
- Bypassing CAPTCHAs, MFA, login requirements, or access restrictions.
- Evading anti-bot systems or access controls.
- Creating fake qualifications or fabricated work experience.
- Inventing answers to sensitive demographic or legal questions.
- Applying to jobs without the user's knowledge.
- Automatically sending recruiter messages or emails.
- A public multi-user SaaS deployment.
- A centralized database containing users' resumes.
- Paid AI APIs as a mandatory dependency.
- Guaranteed compatibility with every website.
- Guaranteed success against every custom or protected web application.

The architecture should allow future expansion without making these capabilities prerequisites for the MVP.

---

# 4. System Architecture

Build ApplyPilot AI as a modular system with clear boundaries between browser interaction, reasoning, personal data, resume generation, and verification.

## 4.1 High-Level Architecture

The main components are:

1. Chrome extension interface.
2. Browser observation engine.
3. Portal intelligence router.
4. Portal adapter registry.
5. General-purpose form understanding engine.
6. Personal profile and knowledge store.
7. Job description analysis engine.
8. Resume tailoring engine.
9. AI provider abstraction.
10. Browser action executor.
11. Verification and recovery engine.
12. Application state manager.
13. Local interaction memory.
14. Diagnostics and usage tracking.
15. Optional local Node.js companion service.

Conceptual flow:

```text
User opens job application
           |
           v
     Quick Apply
           |
           v
    Page Observation
           |
           v
   Job and Form Discovery
           |
           v
   Portal Intelligence Router
           |
      +----+----+
      |         |
      v         v
 Known Portal   Unknown Portal
 Adapter        General Agent
      |         |
      +----+----+
           |
           v
  Profile and Resume Retrieval
           |
           v
  Field Classification and Mapping
           |
           v
  Missing Answer / Resume Analysis
           |
           v
  Selective AI Reasoning and Writing
           |
           v
      Action Planning
           |
           v
      Browser Executor
           |
           v
    State Verification
           |
       +---+---+
       |       |
       v       v
    Success  Recovery
       |       |
       +---+---+
           |
           v
   Review Before Submission
           |
           v
      User Submits
```

The architecture must be implemented as real software modules, not merely represented by this diagram.

## 4.2 Recommended Technology Stack

Use the following stack unless repository inspection reveals an existing implementation that should be preserved.

### Browser extension

- Chrome Extension Manifest V3.
- TypeScript.
- React.
- Vite.
- Chrome `storage` APIs.
- Chrome `scripting` APIs where appropriate.
- Content scripts for webpage observation and interaction.
- Background service worker for coordination.
- Message passing between popup, service worker, content scripts, and optional local service.

### Local application and services

- Node.js with TypeScript for orchestration and optional local API integration.
- Zod or an equivalent runtime schema validator.
- A small local persistence layer using versioned JSON documents or SQLite.
- Python only where a particular document-processing library materially improves resume parsing or document generation.

Do not introduce Python, FastAPI, a remote database, Docker, or cloud infrastructure merely because they are familiar tools. Every dependency must justify its role.

### Testing

- Vitest for unit and integration tests.
- Playwright for browser workflow tests.
- A set of synthetic application forms for deterministic regression testing.
- Real-world portal testing performed manually on authorized accounts.

### AI providers

- Gemini API as a configurable primary provider.
- Groq API as a configurable secondary provider.
- A no-AI mode for basic profile autofill.
- An abstraction layer that supports adding other providers later.

Model identifiers, API endpoints, limits, and supported capabilities must be configurable rather than scattered throughout the codebase.

---

# 5. Browser Extension Interface

The interface must be simple because the main product experience happens on the job application website, not inside a large dashboard.

## 5.1 Extension Popup

The popup should provide:

- ApplyPilot AI logo and name.
- Current page and detected company.
- Detected job title.
- Profile readiness status.
- Selected resume.
- AI provider status.
- Quick Apply button.
- Stop Automation button while an agent run is active.
- Current execution status.
- Last run result.
- Settings and profile navigation.
- Application history access.

Example:

```text
ApplyPilot AI

Company: Example Technologies
Role: Machine Learning Intern

Profile: Ready
Resume: ML Engineer Resume
AI: Gemini

[ Quick Apply ]

Status:
Inspecting application form...

Settings | Profile | History
```

The displayed company and role must come from actual page observations. If the information cannot be detected, show "Unknown" rather than inventing it.

## 5.2 Quick Apply Behavior

When Quick Apply is clicked:

1. Create a unique application-run ID.
2. Check that a valid profile exists.
3. Inspect the active tab.
4. Detect whether the page appears to contain an application form.
5. Extract available job information.
6. Initialize the application state machine.
7. Begin automatic execution.
8. Display concise progress updates.
9. Allow the user to stop the workflow.
10. Preserve the run state if the service worker restarts.

The button must not trigger duplicate concurrent runs for the same tab and application.

If a run is already active, disable the start action or provide a clear resume/stop control.

## 5.3 In-Page Status Indicator

Provide an optional unobtrusive indicator showing states such as:

- Inspecting page.
- Reading job description.
- Mapping fields.
- Tailoring resume.
- Filling fields.
- Verifying entries.
- Waiting for user verification.
- Ready for review.
- Blocked.

Avoid overlays that cover application fields or interfere with normal page interactions.

The user must be able to stop automation immediately.

---

# 6. Personal Profile Vault

The profile vault is the source of truth for the user's identity, background, experience, and preferences.

It must be completed before the first application.

## 6.1 Profile Sections

### Personal information

- Full legal name.
- Preferred name.
- Email.
- Phone.
- Current city.
- State or region.
- Country.
- Postal code.
- Current address, if the user chooses to provide it.
- LinkedIn URL.
- GitHub URL.
- Portfolio URL.
- Other professional links.

### Education

Each education record should support:

- Institution name.
- Degree.
- Field of study.
- Start date.
- Expected graduation date.
- Actual graduation date, if applicable.
- Grade or CGPA.
- Grading scale.
- Relevant coursework.
- Academic distinctions.

### Skills

Organize skills into categories:

- Programming languages.
- Data science.
- Machine learning.
- Deep learning.
- NLP.
- Computer vision.
- Generative AI.
- Agentic AI.
- Databases.
- Backend development.
- Frontend development.
- Cloud and deployment.
- Developer tools.
- Other skills.

Each skill may optionally have a proficiency level, evidence source, and last-verified date.

Do not automatically claim proficiency merely because a technology appears in a project dependency.

### Projects

Each project should contain:

- Project name.
- Short description.
- Problem solved.
- Architecture.
- Technologies used.
- Personal contribution.
- Verified achievements.
- Measured metrics and their sources.
- GitHub repository.
- Live deployment URL.
- Project dates.
- Relevant technical concepts.
- Evidence supporting each claim.

### Experience

Each internship or employment record should contain:

- Employer.
- Position.
- Start and end dates.
- Responsibilities.
- Achievements.
- Technologies used.
- Verified metrics.
- Employment type.
- Supporting evidence.

### Certifications

- Certification title.
- Issuer.
- Issue date.
- Expiration date, if any.
- Credential ID, if applicable.
- Credential URL.

### Application preferences

- Preferred role categories.
- Preferred locations.
- Remote, hybrid, or onsite preference.
- Availability date.
- Internship or full-time preference.
- Work authorization information explicitly provided by the user.
- Willingness to relocate.
- Salary expectations, only when provided.
- Notice period, if relevant.
- Preferred resume template.
- Preferred resume length.

## 6.2 Profile Data Integrity

Every important personal fact should have provenance.

A field may be sourced from:

- User-entered data.
- An explicitly approved import from a resume.
- An explicitly approved prior answer.
- A verified application record.
- A derived value that has been checked and approved.

Never silently transform an inferred value into a verified fact.

Examples:

- A birth date may be used to calculate age if the date and calculation rules are unambiguous.
- Current age should not be guessed from an academic year.
- Graduation year should come from the saved education record.
- Work authorization must not be inferred from citizenship, location, or college attendance.
- A missing salary expectation must remain missing until the user supplies a value or approves an explicit response strategy.

The user must be able to edit and delete profile records.

---

# 7. Resume Management System

Resume management is a core subsystem, not a small attachment feature.

## 7.1 Master Resume

The system must maintain a canonical master resume containing all verified information relevant to professional applications.

This is not necessarily the document sent to every employer.

The master resume should preserve the complete inventory of:

- Education.
- Projects.
- Experience.
- Skills.
- Certifications.
- Achievements.
- Professional links.
- Supporting metrics.

The master record must be separate from the tailored output documents.

Tailoring a resume must never overwrite the original master resume.

## 7.2 Resume Variants

Allow the user to maintain multiple versions, for example:

- AI/ML Engineer.
- Data Scientist.
- Data Analyst.
- Software Engineer.
- Generative AI Engineer.
- Research Internship.

Each variant may prioritize different projects, skills, and experiences without changing underlying facts.

The agent should select the most relevant variant based on the job description, but the user must be able to override that selection.

## 7.3 Resume Import

Support common formats:

- PDF.
- DOCX.
- TXT.
- Markdown, where useful.

The parser should extract structured sections, preserve source text, and identify uncertain parsing results.

Do not assume every PDF contains extractable text. Scanned PDFs may require OCR, which can be added as an optional capability.

After importing a resume, show the extracted information for user confirmation before treating it as the master profile.

## 7.4 Resume Tailoring Pipeline

For every new job application:

1. Extract the job description.
2. Identify the role, required skills, preferred skills, responsibilities, experience requirements, and relevant keywords.
3. Compare these requirements against the user's verified profile.
4. Rank existing projects and experiences by relevance.
5. Select an appropriate resume variant.
6. Reorder relevant skills and experience where justified.
7. Rewrite supported bullet points for clarity and relevance.
8. Add relevant existing facts that were omitted from the selected variant, when space permits.
9. Remove or shorten lower-relevance content only according to explicit tailoring rules.
10. Validate all factual claims against the master record.
11. Generate the final document using a controlled template.
12. Validate the final page count, section preservation, formatting, and content.
13. Save the tailored document as a new version.
14. Use the generated file for the current application when upload is supported.

### Important tailoring constraints

- Do not invent work experience.
- Do not claim a technology that the user has not actually used.
- Do not fabricate numerical improvements, accuracy, scale, revenue, users, or other metrics.
- Do not upgrade a basic prototype into a production deployment unless that is factually true.
- Do not turn an academic project into employment experience.
- Do not change dates to conceal employment gaps.
- Do not claim certifications that are absent from the verified profile.
- Do not remove critical qualifications simply because the model overlooked them.
- Do not overwrite the master resume.
- Do not allow keyword optimization to create false claims.

The objective is relevance and clarity, not keyword stuffing.

## 7.5 One-Page Resume Policy

The default resume preference should be **one page** for the user's internship and entry-level applications.

However, this is a formatting requirement, not permission to delete important facts arbitrarily.

Implement the following priority order:

1. Preserve factual correctness.
2. Preserve essential contact information.
3. Preserve the most relevant education and experience.
4. Preserve the strongest relevant projects and verified achievements.
5. Preserve relevant skills and required qualifications.
6. Reduce verbosity and redundant wording.
7. Adjust spacing and typography within readable limits.
8. Remove genuinely low-relevance material only when justified.

If the resume cannot fit without compromising readability or critical content, report that the one-page constraint could not be satisfied cleanly. Never claim success without checking the rendered document.

The page limit must be configurable.

## 7.6 Controlled Document Generation

Use a stable DOCX or LaTeX template.

The AI should generate structured resume content, not control page layout through free-form instructions.

A document-generation module should control:

- Font family.
- Font size.
- Margins.
- Section spacing.
- Bullet indentation.
- Line spacing.
- Header layout.
- Link formatting.
- Page breaks.
- Section order.

Render the document and inspect its actual page count before accepting it.

A one-page DOCX that becomes two pages in PDF conversion must fail validation.

## 7.7 Resume Tailoring Output

For each application, save:

- Original master resume reference.
- Selected variant.
- Job description snapshot or approved extract.
- Tailored resume document.
- Tailoring timestamp.
- Validation report.
- Any warnings requiring review.

Use stable, collision-resistant filenames, for example:

`Company_Role_Resume_2026-10-21.pdf`

Do not expose unnecessary personal information in filenames.

---

# 8. Job Description Intelligence

The job description is essential context for both resume tailoring and answer generation.

## 8.1 Extraction Sources

Attempt to extract job information from:

- Page headings.
- Job title elements.
- Company name.
- Main job description content.
- Structured metadata.
- Relevant page links.
- Job-specific sections.
- Application form context.
- Existing structured job data, when available.

The system should distinguish the actual job description from:

- Navigation menus.
- Related job recommendations.
- Cookie banners.
- Footer text.
- Advertisements.
- Unrelated content.

## 8.2 Structured Job Representation

Normalize extracted information into a validated structure containing:

- Job title.
- Company.
- Job URL.
- Job description text.
- Required qualifications.
- Preferred qualifications.
- Responsibilities.
- Required technical skills.
- Preferred technical skills.
- Education requirements.
- Experience requirements.
- Location.
- Employment type.
- Work arrangement.
- Relevant keywords.
- Source confidence.
- Extraction warnings.

Missing fields must be represented as unknown, not invented.

## 8.3 Job Matching

Calculate a transparent relevance score based on factors such as:

- Required-skill coverage.
- Preferred-skill coverage.
- Project relevance.
- Experience relevance.
- Education compatibility.
- Role alignment.
- Explicit eligibility requirements.

This score is a decision-support metric, not a prediction of hiring probability.

The system should explain which profile evidence supports the match.

---

# 9. Universal Form Observation Engine

This subsystem enables the extension to operate on unfamiliar websites.

It must not depend on a fixed list of field names or portal-specific selectors.

## 9.1 Initial DOM Inspection

When the agent starts, inspect the current document for:

- Text inputs.
- Email inputs.
- Telephone inputs.
- Number inputs.
- Date inputs.
- URL inputs.
- Textareas.
- Select elements.
- Radio groups.
- Checkboxes.
- File inputs.
- Buttons.
- Links.
- Labels.
- Form elements.
- Accessible names.
- Placeholder text.
- ARIA attributes.
- Relevant nearby text.
- Required indicators.
- Validation messages.
- Fieldset and legend context.
- Custom control containers.

Ignore irrelevant page content where possible.

Do not indiscriminately serialize the entire webpage and send it to an AI model.

## 9.2 Field Representation

Represent each detected field using a stable internal structure.

Example:

```json
{
  "fieldId": "field_014",
  "tagName": "input",
  "inputType": "text",
  "label": "Full Name",
  "placeholder": "Enter your full name",
  "ariaLabel": null,
  "required": true,
  "visible": true,
  "enabled": true,
  "options": [],
  "currentValue": "",
  "sectionContext": "Personal Information",
  "semanticCandidates": ["full_name", "legal_name"],
  "confidence": 0.99
}
```

This is an example of an internal representation, not a literal selector to use on every website.

Never assume the example's field IDs exist on real pages.

## 9.3 Semantic Field Classification

Map fields into semantic categories such as:

### Identity

- First name.
- Middle name.
- Last name.
- Full name.
- Preferred name.
- Email.
- Phone.
- Date of birth.
- Age.

### Address

- Address line.
- City.
- State.
- Country.
- Postal code.

### Education

- College.
- University.
- Degree.
- Major.
- Graduation year.
- CGPA.
- GPA.
- Education level.

### Professional information

- Current employer.
- Current job title.
- Previous employer.
- Years of experience.
- Internship experience.
- Notice period.
- Availability date.
- Current salary.
- Expected salary.

### Skills and qualifications

- Programming languages.
- Technical skills.
- Certifications.
- Portfolio.
- GitHub.
- LinkedIn.
- Relevant projects.

### Eligibility and legal questions

- Work authorization.
- Sponsorship requirements.
- Willingness to relocate.
- Ability to work onsite.
- Age or legal eligibility.
- Equal-opportunity questions.
- Disability and demographic questions.

These categories must not automatically determine answers to sensitive questions.

### Open-ended questions

- Why do you want to join us?
- Why are you a good fit?
- Describe a relevant project.
- What interests you about this role?
- Describe a technical challenge.
- Explain your experience with a technology.
- Describe your strengths.
- Additional information.

### Administrative questions

- Resume upload.
- Cover letter upload.
- Portfolio attachment.
- References.
- Consent checkboxes.
- Application declarations.

Each field must also have an interaction classification and risk classification.

## 9.4 Label Interpretation

Use multiple signals in the following order:

1. Explicit associated label.
2. Accessible name.
3. ARIA label or labelled-by reference.
4. Field name and ID.
5. Placeholder.
6. Nearby visible text.
7. Parent section heading.
8. Question text.
9. Form structure.
10. AI-based semantic interpretation.

The order is a priority, not a rigid rule. If signals conflict, the system should mark the field as ambiguous rather than blindly selecting the first candidate.

## 9.5 Unknown Field Handling

If a field cannot be understood deterministically:

1. Collect its relevant label, accessible name, nearby context, type, and available options.
2. Remove unrelated page content.
3. Send a compact representation to the selected AI provider.
4. Ask for the most likely semantic category and the evidence supporting it.
5. Validate the response against an approved schema.
6. Compare it with the user's profile.
7. Apply it only when the match is sufficiently reliable.

If the field is genuinely unknown, leave it unresolved and report it.

The goal is autonomous completion, not filling every field with a potentially incorrect answer.

---

# 10. Portal Intelligence Router and Adapter Registry

The system should use a hybrid architecture.

## 10.1 Known-Portal Strategy

For known portals, use tested adapters that encode stable interaction knowledge.

An adapter may define:

- Portal identification rules.
- Common form structures.
- Known field aliases.
- Navigation patterns.
- Common dropdown behavior.
- Resume upload behavior.
- Multi-step workflow patterns.
- Known validation patterns.
- Known recovery strategies.
- Adapter version.
- Test coverage.
- Last successful test timestamp.

Adapters must not assume that every page on a portal has the same structure.

Even for known portals, inspect the live page and validate the adapter's assumptions.

## 10.2 Unknown-Portal Strategy

For unfamiliar portals:

1. Inspect the live DOM.
2. Build a semantic page model.
3. Identify the current form and current step.
4. Identify interactive controls.
5. Determine required fields.
6. Map fields to profile records.
7. Generate only necessary answers.
8. Build a proposed action plan.
9. Execute safe actions.
10. Verify outcomes.
11. Recover from failures where possible.

This is the general-purpose execution path.

Unknown portals must not be treated as failures merely because no adapter exists.

## 10.3 Adapter Registry

Use a local registry.

Each adapter should have:

- Unique identifier.
- Portal hostname patterns.
- Version.
- Recognition rules.
- Capabilities.
- Interaction strategies.
- Tests.
- Reliability metrics.
- Known limitations.

Avoid using broad hostname matching that accidentally applies one adapter to an unrelated website.

## 10.4 Learning New Portals

After a successful application workflow, the system may save reusable interaction patterns.

Examples:

- A reliable mapping between a visible label and a field type.
- A safe way to open a custom dropdown.
- A method to identify the next step button.
- A stable strategy for detecting a resume upload control.

Learning must be based on observed behavior, not merely on an LLM's proposed actions.

Store:

- The observed pattern.
- The strategy used.
- Whether the action succeeded.
- Verification evidence.
- Relevant page structure fingerprints.
- Portal and version context.
- Confidence and recency.

Do not save personal answers as portal-wide facts.

Do not reuse a learned mapping if the current page structure differs materially from the structure on which it was learned.

A saved strategy is a hypothesis to validate, not an unquestionable instruction.

---

# 11. Agent Harness

The harness is the central orchestration layer.

It is responsible for controlling the AI, browser actions, application state, safety checks, retries, and verification.

The model should never be allowed to execute arbitrary browser actions without validation.

## 11.1 Agent Loop

Implement the following loop:

```text
OBSERVE
   |
   v
BUILD STATE
   |
   v
CLASSIFY CURRENT TASK
   |
   v
PLAN NEXT ACTION
   |
   v
VALIDATE ACTION
   |
   v
EXECUTE ACTION
   |
   v
VERIFY RESULT
   |
   +---- Success ----> Update State
   |
   +---- Failure ----> Diagnose and Recover
   |
   +---- Blocked ----> Pause and Explain
```

The loop must have explicit termination conditions.

It must not run indefinitely.

## 11.2 Observe

Collect the minimum information needed to understand the current state:

- URL.
- Page title.
- Job description.
- Visible form fields.
- Current values.
- Enabled and disabled states.
- Current step.
- Validation messages.
- Relevant modal or dropdown state.
- Available actions.
- Recent interaction results.

Observation should be repeated after actions that can alter the page structure.

## 11.3 Plan

Create a structured action plan.

Possible action types:

- Fill text field.
- Select dropdown option.
- Select radio option.
- Toggle checkbox.
- Upload supported file.
- Open custom dropdown.
- Select autocomplete suggestion.
- Navigate to next form step.
- Scroll to a relevant section.
- Reinspect the page.
- Retry a failed field.
- Pause for user input.
- Mark the current task complete.

Every action must have:

- Target field reference.
- Intended value or operation.
- Evidence supporting the decision.
- Expected outcome.
- Risk classification.
- Confidence.
- Verification procedure.

## 11.4 Validate Before Execution

Before executing an action, check:

- Does the target exist?
- Is the target still associated with the same field?
- Is it visible or otherwise legitimately interactable?
- Is it enabled?
- Does the proposed value match the field type?
- Does the value come from a verified source?
- Does the action require human approval?
- Has the page changed since the plan was created?
- Is the action within the allowed action set?

Reject invalid actions.

## 11.5 Execute

Use deterministic browser interaction functions.

Do not allow the LLM to generate arbitrary JavaScript and execute it in the page.

Expose a constrained action interface such as:

```typescript
type AgentAction =
  | {
      type: "fill_text";
      fieldId: string;
      value: string;
    }
  | {
      type: "select_option";
      fieldId: string;
      optionValue: string;
    }
  | {
      type: "set_checkbox";
      fieldId: string;
      checked: boolean;
    }
  | {
      type: "select_radio";
      fieldId: string;
      optionValue: string;
    }
  | {
      type: "upload_file";
      fieldId: string;
      fileReference: string;
    }
  | {
      type: "inspect_again";
    }
  | {
      type: "navigate_next";
    }
  | {
      type: "pause_for_user";
      reason: string;
    };
```

Extend this set only when a real use case requires it.

The executor must validate each action independently.

## 11.6 Verify

After every meaningful action or group of compatible actions:

- Confirm the intended value is present.
- Confirm the page accepted the change.
- Check for validation errors.
- Check whether the form structure changed.
- Check whether a custom control needs additional interaction.
- Update the application state.
- Record success or failure.

Do not rely only on the value attribute. Some frameworks maintain internal state that differs from a simple DOM mutation.

Use supported interaction mechanisms and appropriate events, then verify the actual rendered result.

## 11.7 Recovery

When an action fails:

1. Capture the error.
2. Reinspect the relevant part of the page.
3. Determine whether the target moved, disappeared, changed type, or became disabled.
4. Retry using a different supported strategy if safe.
5. Verify the new result.
6. Stop after a bounded number of attempts.

Use a configurable retry budget. A sensible initial default is two recovery attempts per failed action, excluding harmless observation retries.

Avoid repeating an action if doing so could create duplicate records, duplicate uploads, or unintended changes.

## 11.8 State Machine

Maintain explicit application states such as:

- IDLE.
- INITIALIZING.
- OBSERVING.
- EXTRACTING_JOB.
- DISCOVERING_FORM.
- MAPPING_FIELDS.
- TAILORING_RESUME.
- PLANNING.
- FILLING.
- VERIFYING.
- ADVANCING_STEP.
- WAITING_FOR_USER.
- READY_FOR_REVIEW.
- COMPLETED.
- PARTIALLY_COMPLETED.
- BLOCKED.
- CANCELLED.
- FAILED.

All state transitions must be validated.

The UI should display an accurate status derived from this state machine.

---

# 12. Browser Interaction Engine

This engine executes the actions proposed by the harness.

It should support multiple strategies instead of relying on a single method.

## 12.1 Standard HTML Controls

Support:

- Text inputs.
- Email inputs.
- Phone inputs.
- Number inputs.
- Date inputs.
- Textareas.
- Native select elements.
- Checkboxes.
- Radio groups.
- File inputs.

For each control, use a suitable interaction method and verify the resulting value.

## 12.2 React and Other Controlled Inputs

Modern forms often use React, Vue, Angular, or other frameworks.

Changing a DOM property alone may not update application state.

Implement framework-compatible interactions using normal browser input mechanisms where possible, including focus, input, change, keyboard, and selection events as appropriate.

Do not use undocumented framework internals as the default approach.

After interaction, inspect the rendered value and relevant application feedback.

## 12.3 Custom Dropdowns

Support custom dropdowns that are implemented using buttons, divs, listboxes, or other accessible controls.

Strategy:

1. Identify the control's accessible name and role.
2. Determine whether it is already open.
3. Open the control through an appropriate browser interaction.
4. Observe the newly rendered options.
5. Match the desired option against its actual label and value.
6. Select the option.
7. Verify that the chosen value is displayed and accepted.

Do not assume that a native select API can control every custom dropdown.

## 12.4 Autocomplete and Suggestions

For autocomplete fields:

1. Enter the intended query.
2. Wait for the suggestions to appear.
3. Observe the actual options.
4. Select the matching suggestion.
5. Verify the selection.

Typing a string into an autocomplete field may not establish a valid selection. The agent must detect this.

## 12.5 Checkboxes and Radio Buttons

The agent must distinguish between:

- A checkbox that can be selected independently.
- A group of mutually exclusive radio buttons.
- A consent declaration.
- A required eligibility question.
- An optional preference.

Do not select a checkbox simply because it is required.

For sensitive, legal, or binding declarations, require an explicit saved answer or pause for user confirmation according to the configured policy.

## 12.6 Date Fields

Handle:

- Native date inputs.
- Text-based date fields.
- Date pickers.
- Separate month, day, and year controls.

Use the portal's expected date format.

Do not guess dates or convert formats without validation.

## 12.7 File Uploads

Support resume and cover letter uploads where the browser API and website permit them.

Requirements:

- Use an explicit file reference from the user's local resume library.
- Verify that the file exists.
- Verify that the field accepts the file type.
- Select the correct tailored document.
- Confirm that the webpage recognizes the upload.
- Detect filename and upload-status changes.
- Avoid uploading the wrong document to a different attachment field.

A website may require user interaction for file selection, or may impose browser restrictions. In those cases, report the limitation instead of attempting to bypass it.

## 12.8 Shadow DOM

Inspect accessible open shadow roots when necessary.

Do not assume that all shadow roots are open or that every internal control can be accessed.

Closed shadow roots and inaccessible page structures may require a different supported strategy or user assistance.

## 12.9 Iframes

Support same-origin frames where the extension has the necessary permissions.

Cross-origin frames require appropriate extension permissions and browser-supported access. Some embedded third-party contexts may remain inaccessible.

Detect these limitations explicitly.

Do not silently report successful completion when a required field is inside an inaccessible frame.

## 12.10 Dynamic Forms

Use a mutation observer or equivalent event-driven observation mechanism to detect relevant changes such as:

- New fields appearing.
- Conditional questions being revealed.
- Dropdown options changing.
- Form steps changing.
- Validation messages appearing.
- Sections becoming enabled.
- Fields disappearing.

Do not continuously reprocess the entire DOM at a high frequency.

Debounce observation and process meaningful changes.

## 12.11 Scrolling and Visibility

The agent may scroll to a relevant section when necessary.

It should:

- Find the appropriate target.
- Scroll into view.
- Confirm that the target is interactable.
- Perform the action.
- Continue without requiring a manual click.

Avoid unnecessary page movement.

## 12.12 Accessibility and Keyboard Fallback

Prefer semantically identified controls and accessible interaction paths.

When appropriate, use keyboard-based interaction as a fallback.

Keyboard navigation must not assume a fixed tab order across all portals.

After any fallback, verify the target and result.

---

# 13. AI Provider and Cost Management

The system must be designed for free-tier API use.

The goal is not to eliminate AI completely. The goal is to avoid spending AI tokens on work that deterministic code can do more reliably.

## 13.1 Provider Abstraction

Create a common provider interface.

Example:

```typescript
interface AIProvider {
  generateStructuredOutput<T>(
    request: StructuredRequest<T>
  ): Promise<StructuredResult<T>>;

  generateText(
    request: TextGenerationRequest
  ): Promise<TextGenerationResult>;
}
```

The exact interfaces may differ based on the selected SDKs, but the architecture must remain provider-independent.

Implement:

- Gemini provider.
- Groq provider.
- Provider configuration.
- Request validation.
- Response validation.
- Timeout handling.
- Rate-limit handling.
- Retry policy.
- Usage logging.
- Error classification.

Never assume that two providers support the same model names, structured-output features, or request parameters.

## 13.2 Rules-First Processing

The following tasks should normally use deterministic code:

- Reading a known profile field.
- Mapping an exact known label.
- Filling an email field.
- Filling a phone field.
- Matching a known field alias.
- Formatting an already verified date.
- Selecting an exact option.
- Detecting a missing required value.
- Checking whether a file exists.
- Counting resume pages.
- Validating document structure.

AI should primarily handle:

- Ambiguous field interpretation.
- Job description analysis.
- Ranking relevant projects and experiences.
- Tailoring resume bullet points.
- Generating job-specific application answers.
- Interpreting unfamiliar custom form structures.
- Diagnosing failures that cannot be resolved deterministically.

## 13.3 Batch AI Requests

When possible, send several related ambiguous fields in one request.

For example, instead of separately asking the model to interpret:

- Relevant project experience.
- Why this role?
- Why this company?
- Relevant technical skills.

Send one compact request containing the job context, verified profile evidence, and all relevant questions.

Require separate answers for each question in a structured response.

Do not batch unrelated operations when the results depend on earlier browser state changes.

## 13.4 Token Optimization

Implement:

- Compact field representations.
- Bounded job description text.
- Relevant profile retrieval.
- No unnecessary full-resume transmission.
- Reuse of validated job context within the current application.
- Avoidance of repeated prompts for unchanged questions.
- Response length limits.
- Cached non-sensitive semantic mappings.
- Request deduplication.
- Per-application token and request tracking.

Do not reuse generated answers blindly across unrelated jobs.

A cache key should account for the question, job context, relevant profile evidence, provider/model version, and applicable generation rules.

## 13.5 Provider Fallback

If the primary provider returns a rate-limit error:

1. Determine whether the request is safe to retry.
2. Check whether a configured secondary provider is available.
3. Switch providers if appropriate.
4. Validate the returned response using the same schema.
5. Continue the workflow only if the result passes validation.

Do not create an uncontrolled retry loop.

If both providers are unavailable, continue with deterministic autofill wherever possible.

## 13.6 API Key Management

The user does not have an Anthropic API key.

Claude Code is used to develop the software, not as the runtime model API for the finished extension.

The runtime should support user-provided Gemini and Groq API keys.

For the personal-use MVP:

- Never hardcode API keys in source code.
- Never commit keys to Git.
- Never print keys in logs.
- Never expose keys to webpage content scripts.
- Restrict key access to the extension's trusted orchestration component or local companion.
- Document the limitations of storing keys in extension storage.
- Prefer a local companion service for provider calls when it materially improves key isolation.
- Bind any local companion server to loopback and implement request authentication and origin checks.
- Never expose the companion service to the public network by default.

A personal extension can be convenient without claiming that locally stored API keys are perfectly secure.

Free-tier quotas vary by provider and model. The extension must show configuration and usage information without promising unlimited operation.

---

# 14. Job-Specific Answer Generation

The system must generate answers that are truthful, relevant, and appropriately tailored.

## 14.1 Sources of Truth

The answer generator may use:

- Verified profile information.
- Master resume.
- Selected resume variant.
- Verified project records.
- Current job description.
- Explicitly approved saved answers.
- The exact question and its surrounding form context.

The job description is evidence about the employer's requirements, not evidence about the user's qualifications.

## 14.2 Answer Generation Process

For each open-ended question:

1. Identify the exact question.
2. Determine the answer category.
3. Retrieve relevant profile facts.
4. Retrieve relevant project or experience evidence.
5. Extract job-specific requirements.
6. Draft a concise answer.
7. Validate factual claims.
8. Check for unsupported metrics or qualifications.
9. Respect any visible character or word limit.
10. Return the answer for browser insertion.
11. Verify that the field accepted the answer.

## 14.3 Example: "Why Are You a Good Fit?"

The agent should:

- Identify the most relevant required skills.
- Select real examples from the user's experience.
- Explain how those examples relate to the role.
- Avoid generic claims unsupported by evidence.
- Avoid claiming professional experience when the evidence is an academic project.
- Produce a concise, natural response.

The answer should be based on evidence rather than a generic template.

## 14.4 Example: "Describe a Project"

The agent should select a relevant project using:

- Technical similarity.
- Problem similarity.
- Role requirements.
- Verified personal contribution.
- Relevant technologies.
- Measured outcomes, when available.

It should not automatically choose the most impressive-sounding project if a different project is more relevant.

## 14.5 Unknown or Sensitive Questions

The system must distinguish between:

- Unknown technical questions that can be researched from the profile.
- Unknown personal facts.
- Sensitive demographic questions.
- Legal declarations.
- Eligibility questions.
- Binding agreements.

Only the first category should normally be resolved autonomously using existing evidence.

For unknown personal facts, ask the user to provide the information.

For sensitive or binding questions, use an explicitly configured verified answer only where appropriate; otherwise pause.

Never infer demographic answers or legal eligibility from unrelated profile information.

---

# 15. Multi-Step Application Navigation

Many job applications contain several steps.

The agent must treat each step as a new observation-and-verification cycle.

## 15.1 Workflow

For each step:

1. Inspect the current page.
2. Determine the current step.
3. Identify newly visible fields.
4. Map and fill the fields.
5. Verify the current step.
6. Detect validation errors.
7. Resolve recoverable errors.
8. Confirm that all required fields are satisfied.
9. Identify the next-step control.
10. Navigate only when the next action is a normal application progression action.
11. Observe the resulting page.
12. Repeat.

Do not assume the next step is always represented by a button labelled "Next".

It may be labelled:

- Continue.
- Save and Continue.
- Review.
- Additional Information.
- Education.
- Experience.

Use the current page structure and interaction evidence.

## 15.2 Navigation Boundaries

The agent must distinguish between ordinary form progression and consequential final actions.

Ordinary progression may be automated when the required fields are valid.

Actions that submit, finalize, certify, or transmit the application require explicit user approval.

Do not click final controls simply because their labels contain the word "Continue" or "Submit". Determine their actual role and consequences from context.

## 15.3 State Persistence

Store the current application state so that a service worker restart or extension popup closure does not destroy the entire workflow.

Persist:

- Application-run ID.
- Current URL.
- Job identity.
- Current step.
- Completed actions.
- Pending actions.
- Verification status.
- Resume reference.
- Relevant errors.
- Last observation timestamp.

Never resume by blindly replaying every previous action. Reobserve the current page and reconcile saved state with reality.

---

# 16. Resume and Cover Letter Upload Workflow

When the application requests a resume:

1. Determine whether the user has enabled job-specific resume tailoring.
2. Extract the job description.
3. Tailor the appropriate resume variant.
4. Validate the generated document.
5. Save the file.
6. Identify the resume upload field.
7. Upload the correct file using supported browser mechanisms.
8. Verify that the website recognizes the upload.
9. Record the uploaded file reference in the application history.

If the website automatically parses the uploaded resume and populates additional fields, inspect those fields after upload.

Do not overwrite user-provided information without checking for conflicts.

Cover letters should be optional.

If a cover letter is required, generate it from the same verified facts and job context. Apply the same factual validation rules as the resume generator.

---

# 17. Confidence and Risk Engine

The system needs a formal policy for deciding which actions it may execute autonomously.

## 17.1 Confidence Dimensions

Track separate confidence scores for:

- Field identification.
- Semantic mapping.
- Profile evidence.
- Generated answer quality.
- Target element identification.
- Action execution.
- Post-action verification.

Do not compress all of these into one unexplained score.

## 17.2 Initial Policy

Use the following initial policy as a configurable starting point.

| Situation | Behavior |
|---|---|
| Exact field-to-profile match | Fill automatically |
| Strong semantic match with verified value | Fill and verify |
| Ambiguous field meaning | Use AI, then validate |
| Low-confidence field interpretation | Leave unresolved |
| Missing personal information | Ask the user |
| Unknown salary expectation | Do not invent |
| Unknown work authorization | Do not infer |
| Sensitive demographic question | Use explicit user-approved policy or pause |
| CAPTCHA or MFA | Pause for the user |
| Failed field interaction | Recover within limits |
| Final application submission | Require explicit approval |

Confidence thresholds must be configurable and calibrated through tests.

Do not interpret an LLM's self-reported confidence as a calibrated probability of correctness.

## 17.3 Execution Risk

Classify actions as:

- **Low risk:** Filling an ordinary text field with a verified profile value.
- **Moderate risk:** Selecting a semantic option or inserting a generated narrative.
- **High risk:** Answering a legal eligibility question or changing a consequential employment declaration.
- **Restricted:** Bypassing access controls, evading verification, or submitting the application without approval.

The risk policy should override convenience when they conflict.

---

# 18. Verification and Quality Assurance

Verification must be an independent part of the architecture.

## 18.1 Field-Level Verification

After filling a field, verify:

- The correct target was used.
- The value is present.
- The value is correctly formatted.
- The value was accepted by the control.
- No validation error appeared.
- No unexpected page change occurred.

For custom controls, verify the displayed selected value, not just the underlying hidden input.

## 18.2 Form-Level Verification

Before advancing to the next step, check:

- Required fields are filled.
- Required fields are valid.
- No unexpected errors are present.
- No known critical field was skipped.
- Uploaded files are recognized.
- The form still corresponds to the intended job.
- The current step has not changed unexpectedly.

## 18.3 Final Application Verification

Before presenting the review screen, verify:

- The correct company and role were identified.
- The intended resume was uploaded.
- The application is on the expected final review step, where supported.
- All supported fields were processed.
- Unresolved fields are listed.
- Errors are clearly explained.
- The application has not been submitted automatically.

## 18.4 Completion Report

Example:

```text
ApplyPilot AI — Application Prepared

Company: Example Technologies
Role: Data Science Intern

Fields filled: 23
Fields verified: 22
Fields requiring review: 1
Resume uploaded: Yes
Resume tailored: Yes
Validation errors: 0

Status: Ready for your review

[Review Application]
```

The numbers must reflect actual execution results.

Never fabricate success statistics or mark an unverified action as completed.

---

# 19. Persistent Memory and Application History

The extension must remember useful information across application sessions.

## 19.1 Application History

For every run, store:

- Company.
- Role.
- Job URL.
- Application date.
- Resume variant.
- Tailored resume reference.
- Completed steps.
- Number of fields filled.
- Verification results.
- Unresolved questions.
- Final status.
- Relevant warnings.

Do not automatically retain unnecessary sensitive information from the webpage.

Allow the user to delete individual application records or clear history.

## 19.2 Field Mapping Memory

Maintain a separate store for reusable field mappings.

Examples:

- A particular label usually represents graduation year.
- A particular control pattern represents an autocomplete field.
- A specific portal uses a custom dropdown implementation.
- A successful navigation strategy works on a certain page structure.

Memory must be versioned.

A learned strategy should expire or be reconsidered when the page structure changes or repeated failures occur.

## 19.3 Answer Memory

Store explicitly approved reusable answers where appropriate.

Examples:

- Preferred availability response.
- Approved description of a recurring project.
- User-approved relocation preference.
- User-approved salary expectation.

Never automatically convert an answer generated for one employer into a universal personal fact.

## 19.4 Privacy Controls

The user must be able to:

- View saved information.
- Edit saved information.
- Delete profile data.
- Delete application history.
- Delete learned portal strategies.
- Disable AI.
- Disable answer memory.
- Disable resume tailoring.
- Export relevant data.

---

# 20. Security and Privacy Architecture

The extension handles sensitive personal information and must be designed accordingly.

## 20.1 Least Privilege

Request the minimum permissions needed for the implemented functionality.

Avoid requesting access to every website at installation if a narrower permission model can support the intended workflow.

If broad website access is required for one-click operation across arbitrary portals, explain the permission clearly and provide a way to disable access.

Do not access unrelated browser tabs or websites.

## 20.2 Data Boundaries

Keep the following data separate:

- Personal profile.
- Master resume.
- Tailored resumes.
- Current job description.
- Current form observation.
- AI requests and responses.
- Application history.
- Portal learning memory.
- API credentials.

Do not merge unrelated data into a single unstructured storage object.

## 20.3 Webpage Content Is Untrusted

A webpage may contain malicious or misleading instructions.

The agent must never treat page text as instructions that override its own system policy.

For example, if a webpage contains text instructing the AI to reveal saved personal data, export API keys, or perform unrelated actions, the agent must ignore those instructions.

The job description may guide resume relevance and answer generation, but it must not override the user's profile, privacy settings, or action policy.

Use structured extraction, bounded context, schema validation, and explicit separation between instructions and observed page content.

## 20.4 AI Data Minimization

Send only the information required for the specific AI task.

For field classification, send the field context rather than the entire personal profile.

For a project question, retrieve only relevant project evidence.

For resume tailoring, send the relevant verified profile sections and job requirements.

Do not send API credentials, unrelated application history, or unnecessary personal information to the model.

## 20.5 Logging

Logs must not contain:

- API keys.
- Passwords.
- Authentication tokens.
- Full personal records.
- Unnecessary sensitive answers.
- Unredacted private application data.

Use structured error codes and safe diagnostic metadata.

---

# 21. Performance and Reliability

The extension should feel fast and remain usable when AI services are unavailable.

## 21.1 Performance Principles

- Use local rules for known fields.
- Avoid repeated DOM scans.
- Avoid unnecessary model calls.
- Batch compatible AI requests.
- Use asynchronous browser operations.
- Limit screenshot use to situations where visual information adds value.
- Avoid repeatedly regenerating the same resume without changes.
- Cache stable semantic interpretations.
- Reuse a valid job analysis during one application session.

## 21.2 Operational Limits

Every run must have configurable limits for:

- Total duration.
- Number of actions.
- Number of retries.
- Number of AI requests.
- Maximum response size.
- Maximum job-description size.
- Maximum number of form fields.
- Maximum number of step transitions.

Limits should be conservative initially and adjusted using real test results.

## 21.3 Failure Handling

The agent must distinguish between:

- Temporary AI provider failure.
- Rate limiting.
- Invalid AI response.
- Missing profile data.
- Field mapping ambiguity.
- Element not found.
- Element no longer visible.
- Validation failure.
- Unsupported control.
- Restricted browser context.
- CAPTCHA or MFA.
- Website navigation failure.
- User cancellation.

Each error must have a recovery policy.

Do not respond to every error by asking the AI to try again.

---

# 22. Local Companion Service

The extension should be developed first without making a companion service mandatory.

However, the architecture should support an optional local Node.js companion if it materially improves reliability.

Potential responsibilities include:

- AI provider requests.
- Resume document generation.
- Resume rendering and page-count validation.
- SQLite persistence.
- Long-running orchestration.
- Local file management.
- Diagnostics.
- Provider usage accounting.

The companion must expose a small, typed API.

Example endpoints:

```text
GET  /health
POST /ai/classify-fields
POST /ai/generate-answers
POST /resume/tailor
POST /resume/validate
GET  /applications/:id
POST /applications/:id/checkpoint
```

These are proposed interfaces, not permission to implement unnecessary endpoints.

The service must:

- Bind to loopback by default.
- Authenticate extension requests.
- Validate request schemas.
- Reject arbitrary file paths.
- Prevent path traversal.
- Limit request sizes.
- Avoid exposing secrets in errors.
- Avoid accepting arbitrary commands or scripts.
- Implement timeouts.
- Handle extension/service restarts.

Do not introduce a remote server simply to relay requests to an AI provider unless there is a concrete reason.

---

# 23. Data Models and Type Safety

Define explicit schemas for the important entities.

At minimum:

### UserProfile

Contains verified personal information, education, experience, projects, skills, certifications, links, and preferences.

### ResumeDocument

Contains the document reference, source variant, parsed content, creation date, validation status, and factual provenance.

### JobContext

Contains job identity, company, URL, extracted description, requirements, skills, and extraction confidence.

### FormField

Contains the observed control type, label evidence, current state, semantic classification, risk, and verification state.

### ApplicationRun

Contains the current execution state, job context, resume reference, actions, errors, and completion report.

### AgentAction

Contains action type, target, intended operation, evidence, validation status, execution result, and verification result.

### PortalAdapter

Contains recognition rules, version, capabilities, interaction strategies, and tests.

### LearnedStrategy

Contains an observed pattern, proposed strategy, validation evidence, reliability, and expiration criteria.

### AIRequestRecord

Contains provider, model, request category, token usage when available, latency, outcome, and a safe error summary.

### ResumeTailoringReport

Contains selected source facts, relevant job requirements, modified sections, validation findings, and output document reference.

Use TypeScript types and runtime validation together. Compile-time types alone do not validate model responses or stored JSON.

---

# 24. AI Output Contracts

Every AI response used by the browser agent must follow a defined schema.

For example, a field-mapping response may contain:

```json
{
  "mappings": [
    {
      "fieldId": "field_014",
      "semanticType": "full_name",
      "profileKey": "personal.fullName",
      "confidence": 0.99,
      "evidence": [
        "The visible label says Full Name"
      ],
      "requiresReview": false
    }
  ]
}
```

Validate:

- Required properties.
- Allowed semantic categories.
- Allowed profile keys.
- Numeric bounds.
- Maximum string lengths.
- Unknown field IDs.
- Duplicate assignments.
- Conflicting mappings.
- Unsupported actions.

The AI may propose a mapping, but deterministic code must decide whether the mapping is allowed.

Do not accept arbitrary executable instructions in model responses.

---

# 25. Testing Strategy

Testing is a core product requirement, not a final cleanup task.

## 25.1 Unit Tests

Test:

- Field classification.
- Semantic alias matching.
- Profile retrieval.
- Confidence policy.
- Answer validation.
- Job requirement extraction.
- Resume factual validation.
- File reference validation.
- State transitions.
- Retry policies.
- Provider error handling.
- Cache invalidation.

## 25.2 Synthetic Form Suite

Create local test pages containing:

1. A basic application form.
2. A form with unusual field labels.
3. A form with duplicate labels.
4. A form with required and optional fields.
5. A form with custom dropdowns.
6. A form with autocomplete.
7. A form with dynamic conditional fields.
8. A multi-step application.
9. A form with validation errors.
10. A form with React-controlled inputs.
11. A form with a resume upload.
12. A form with a simulated cross-origin iframe.
13. A form containing irrelevant or adversarial page text.
14. A form with missing personal information.
15. A form with a sensitive eligibility question.
16. A form where a field becomes disabled during execution.
17. A form that changes its DOM after every step.
18. A form where the same label appears in several sections.

These tests should be deterministic and repeatable.

## 25.3 Integration Tests

Test:

- Extension popup to service worker communication.
- Service worker to content script communication.
- Local companion communication, if implemented.
- AI provider request and response validation.
- Resume generation and rendering.
- Application state persistence.
- Recovery after interruption.
- Cancellation during execution.
- Recovery after extension restart.

Use mocked AI responses for ordinary CI tests. Do not consume free API quota unnecessarily during every test run.

## 25.4 Real Portal Tests

Test a range of real portals using the user's authorized accounts.

Record:

- Portal.
- Browser version.
- Adapter or general-agent path.
- Form complexity.
- Fields discovered.
- Fields filled correctly.
- Fields skipped.
- Validation failures.
- Resume upload result.
- Recovery attempts.
- Final status.

Do not use automated tests to submit fake applications to real employers.

## 25.5 Measurable Acceptance Targets

Use these as initial engineering targets, not pre-existing performance claims:

- 100% factual traceability for generated resume claims.
- 100% of required safety checks enforced.
- No automatic final application submission.
- At least 98% correct autofill on the defined deterministic synthetic test suite.
- At least 95% correct handling of supported standard controls in the test suite.
- No unbounded retry loops.
- No silent success when verification fails.
- Successful cancellation without further scheduled actions.
- Correct persistence and resumption after simulated service-worker interruption.
- Consistent one-page output when the configured one-page resume can fit without compromising the required content and readability.
- Transparent reporting when a target cannot be met.

Measure real-world portal coverage separately from synthetic test accuracy.

---

# 26. Development Plan

Implement this project incrementally.

Do not attempt to build the complete system in one enormous code-generation step.

## Phase 0 — Repository and Architecture Audit

Before modifying anything:

- Inspect the current repository.
- Identify existing code and dependencies.
- Inspect package scripts.
- Inspect the current extension manifest, if any.
- Identify existing profile or resume logic.
- Identify reusable modules.
- Identify broken or incomplete functionality.
- Produce a concise implementation plan.

Do not overwrite existing working functionality without justification.

## Phase 1 — Extension Foundation

Build:

- Manifest V3 setup.
- React popup.
- TypeScript configuration.
- Background service worker.
- Content script.
- Message passing.
- Permission handling.
- Quick Apply button.
- Stop button.
- Basic state indicator.
- Local settings.

Acceptance criterion: the extension loads unpacked in Chrome and can inspect a synthetic form.

## Phase 2 — Profile Vault

Build:

- Profile editor.
- Education records.
- Skills.
- Experience.
- Projects.
- Certifications.
- Preferences.
- Local persistence.
- Import and export.
- Profile validation.

Acceptance criterion: profile data persists after browser restart and can be retrieved by the autofill engine.

## Phase 3 — Deterministic Autofill

Build:

- DOM observer.
- Field discovery.
- Semantic alias dictionary.
- Profile mapping.
- Standard control interaction.
- Field verification.
- Basic error reporting.

Acceptance criterion: Quick Apply fills common fields on a synthetic form without field-by-field user interaction and without making an AI request for exact matches.

## Phase 4 — Universal Field Understanding

Build:

- Rich field context extraction.
- AI field classification.
- Runtime schema validation.
- Confidence and risk policy.
- Unknown-field handling.
- Provider abstraction.
- Gemini integration.
- Groq integration.

Acceptance criterion: unfamiliar but accessible synthetic forms can be interpreted without writing a portal-specific adapter for every form.

## Phase 5 — Job Description Intelligence

Build:

- Job description extraction.
- Job context schema.
- Relevant skill extraction.
- Project relevance ranking.
- Job context caching.
- Extraction warnings.

Acceptance criterion: the system can distinguish the target job description from unrelated page content on the test suite.

## Phase 6 — AI Answer Generation

Build:

- Question classification.
- Evidence retrieval.
- Answer generation.
- Length constraints.
- Factual validation.
- Sensitive-question policy.
- Batch requests.
- Provider fallback.

Acceptance criterion: supported open-ended questions receive grounded answers, and unknown personal facts remain unresolved.

## Phase 7 — Resume Tailoring

Build:

- Resume import.
- Structured master resume.
- Resume variants.
- Job-to-resume matching.
- Tailoring pipeline.
- Controlled document template.
- DOCX generation.
- PDF rendering.
- Page-count validation.
- Factual consistency checks.
- Output history.
- Upload integration.

Acceptance criterion: the extension generates a job-specific resume without overwriting the master resume or introducing unsupported claims.

## Phase 8 — Portal Adapters

Build the adapter interface and add adapters based on actual testing.

Start with the portal structures the user encounters most often.

Do not create dozens of speculative adapters without evidence.

Acceptance criterion: recognized portals use tested strategies, while unknown portals continue through the general-agent path.

## Phase 9 — Agent Recovery and Multi-Step Forms

Build:

- Explicit state machine.
- Action planning.
- Action validation.
- Verification.
- Bounded recovery.
- Dynamic DOM observation.
- Multi-step navigation.
- Checkpoint persistence.
- Cancellation.
- Blocker reporting.

Acceptance criterion: the agent can recover from common synthetic interaction failures without entering an infinite loop or losing application state.

## Phase 10 — Optional Local Companion

Introduce a companion only if the extension's APIs cannot reasonably support the required document-processing or orchestration tasks.

Build the local API, authentication, file handling, persistence, and diagnostics.

Acceptance criterion: the extension communicates with the local service securely and handles service unavailability gracefully.

## Phase 11 — Hardening

Complete:

- Regression tests.
- Privacy review.
- API key protection.
- Permission review.
- Accessibility review.
- Error handling.
- Documentation.
- Build verification.
- Installation instructions.
- Known limitations.
- Manual acceptance testing.

Do not call the project production-ready until these tests have actually been performed.

---

# 27. Recommended Repository Structure

Use a modular structure similar to the following:

```text
applypilot-ai/
│
├── apps/
│   ├── extension/
│   │   ├── manifest.json
│   │   ├── src/
│   │   │   ├── popup/
│   │   │   ├── options/
│   │   │   ├── background/
│   │   │   ├── content/
│   │   │   ├── messaging/
│   │   │   └── styles/
│   │   └── tests/
│   │
│   └── companion/
│       └── src/
│           ├── routes/
│           ├── services/
│           ├── security/
│           └── persistence/
│
├── packages/
│   ├── shared-types/
│   ├── schemas/
│   ├── profile/
│   ├── job-intelligence/
│   ├── form-observer/
│   ├── field-mapper/
│   ├── agent-harness/
│   ├── browser-actions/
│   ├── verification/
│   ├── portal-adapters/
│   ├── resume-engine/
│   ├── ai-providers/
│   └── diagnostics/
│
├── tests/
│   ├── fixtures/
│   ├── synthetic-portals/
│   ├── integration/
│   └── regression/
│
├── docs/
│   ├── architecture.md
│   ├── data-models.md
│   ├── security.md
│   ├── resume-tailoring.md
│   ├── testing.md
│   └── installation.md
│
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── pnpm-workspace.yaml
```

This is a proposed structure, not a requirement to create every directory immediately. Build modules as their corresponding phases are implemented.

If a simpler single-package structure is sufficient initially, use it while maintaining clear module boundaries.

Never create empty placeholder modules just to match the directory tree.

---

# 28. Product Success Criteria

ApplyPilot AI succeeds when it reduces the user's repetitive work without reducing the accuracy of their applications.

Measure:

### Automation

- Percentage of fields discovered.
- Percentage of supported fields filled.
- Percentage of filled fields verified.
- Number of manual field interactions required.
- Number of successful multi-step workflows.

### Reliability

- Incorrect field mapping rate.
- Incorrect autofill rate.
- Recovery success rate.
- Silent failure rate.
- Resume upload success rate.
- Portal adapter regression rate.

### AI efficiency

- AI requests per application.
- Input and output tokens per application.
- Rate-limit failures.
- Cache hit rate.
- Cost per application, where measurable.

### Resume quality

- Factual consistency.
- Preservation of critical experience.
- Relevance to the job description.
- Page-count compliance.
- Formatting validity.
- Unsupported claim count.

### User experience

- Time required to prepare an application.
- Number of unresolved fields.
- Number of unnecessary interruptions.
- Number of successful one-click preparation workflows.

The most important product metric is not the number of applications the system claims to complete. It is the percentage of applications prepared correctly with minimal user intervention.

---

# 29. Implementation Rules for Claude Code

Follow these rules throughout development.

## 29.1 Work From the Existing Repository

Inspect the current project before changing files.

Read relevant configuration, existing source code, and available tests.

Preserve working functionality and reuse suitable components.

Do not assume the repository is empty.

## 29.2 Implement Real Functionality

Do not create a visually impressive extension with nonfunctional controls.

Every implemented feature must have working behavior.

Do not replace real browser interactions with simulated success messages.

Do not claim that a form was filled if the page was not actually updated and verified.

Do not claim that a resume was validated if no validation occurred.

## 29.3 Use Small, Testable Modules

Keep these responsibilities separate:

- Observation.
- Field mapping.
- AI reasoning.
- Browser actions.
- Verification.
- Resume generation.
- Provider configuration.
- Persistence.
- UI.

Do not build a single giant content script containing the entire application.

## 29.4 Keep AI Behind Typed Interfaces

All model inputs and outputs must pass through typed interfaces and runtime validation.

Do not allow model-generated code to execute in the browser.

Do not allow arbitrary model-generated actions to bypass the action validator.

## 29.5 Avoid Unnecessary Complexity

Do not add:

- A vector database when simple local lookup is enough.
- An external backend without a demonstrated need.
- Multiple agents when a deterministic pipeline works.
- A complicated memory framework for simple field aliases.
- A paid model as a mandatory runtime dependency.
- A large orchestration library when a small state machine is sufficient.

Start with the smallest reliable implementation and extend it when tests expose a genuine limitation.

## 29.6 Test After Every Phase

For each phase:

1. Implement the functionality.
2. Add or update tests.
3. Run the tests.
4. Fix regressions.
5. Verify the build.
6. Update documentation.
7. Summarize what works and what remains incomplete.

Do not silently skip failed tests.

Do not mark a phase complete based solely on code generation.

## 29.7 Maintain an Honest Progress Report

Maintain a project checklist with:

- Implemented features.
- Partially implemented features.
- Unimplemented features.
- Known limitations.
- Failed tests.
- Required user configuration.
- Next implementation tasks.

Separate verified behavior from planned behavior.

---

# 30. Final Product Definition

ApplyPilot AI is a personal, adaptive browser automation system for preparing job applications.

Its core experience is simple:

**Open a job application → Click Quick Apply → Let the agent prepare the application → Review → Submit manually.**

Its internal design must be sophisticated enough to support that simplicity.

The product combines:

- Deterministic browser automation.
- Semantic form understanding.
- AI-generated, evidence-based answers.
- Job-specific resume tailoring.
- Known-portal adapters.
- General-purpose automation for unfamiliar portals.
- Persistent, validated interaction memory.
- Bounded recovery and verification.
- Cost-aware AI provider selection.
- Local personal-data management.
- Explicit user control over consequential actions.

The central architectural principle is:

**Use rules for predictable work, AI for interpretation, a constrained harness for execution, and independent verification to establish success.**

Do not optimize for the illusion of universal compatibility. Optimize for the ability to inspect an unfamiliar form, make a justified plan, execute supported actions, detect failures, recover safely, and clearly report what remains unresolved.

That is the foundation of a useful personal AI job application agent.