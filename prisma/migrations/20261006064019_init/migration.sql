-- pgvector must exist before tables with vector(1536) columns are created.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'TA', 'INSTRUCTOR', 'RESEARCH_ADMIN', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "CourseRole" AS ENUM ('STUDENT', 'TA', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DROPPED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'OIDC');

-- CreateEnum
CREATE TYPE "PrivilegedPermission" AS ENUM ('TRANSCRIPT_READ_RAW');

-- CreateEnum
CREATE TYPE "ProgrammingLanguage" AS ENUM ('PYTHON', 'JAVASCRIPT', 'SCALA');

-- CreateEnum
CREATE TYPE "TopicRelationType" AS ENUM ('PREREQUISITE_OF', 'RELATED_TO', 'PART_OF', 'TRANSFER_TO');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('LECTURE_NOTES', 'SLIDES', 'READING', 'EXAMPLE_CODE', 'LINK', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResourceAccessScope" AS ENUM ('COURSE_ALL', 'STAFF_ONLY', 'ASSIGNMENT_SCOPED');

-- CreateEnum
CREATE TYPE "AssignmentState" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED_PROTECTED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignmentFormat" AS ENUM ('CODING', 'WRITTEN', 'QUIZ');

-- CreateEnum
CREATE TYPE "SolutionReleaseMode" AS ENUM ('NEVER', 'ON_CLOSE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ResourceScopeMode" AS ENUM ('ALL_COURSE_RESOURCES', 'SELECTED_RESOURCES', 'NONE');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('CODING', 'SHORT_ANSWER', 'ESSAY', 'MULTIPLE_CHOICE');

-- CreateEnum
CREATE TYPE "TestVisibility" AS ENUM ('PUBLIC', 'HIDDEN', 'DIAGNOSTIC');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('RECEIVED', 'GRADING', 'GRADED', 'RETURNED', 'FAILED');

-- CreateEnum
CREATE TYPE "CodeRunKind" AS ENUM ('RUN', 'PUBLIC_TESTS', 'GRADING');

-- CreateEnum
CREATE TYPE "CodeRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'OK', 'COMPILE_ERROR', 'RUNTIME_ERROR', 'TIMEOUT', 'MEMORY_LIMIT', 'OUTPUT_LIMIT', 'RUNNER_UNAVAILABLE', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "GradeScope" AS ENUM ('SUBMISSION', 'QUESTION');

-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('PENDING', 'SUGGESTED', 'FINAL');

-- CreateEnum
CREATE TYPE "GradingMethod" AS ENUM ('DETERMINISTIC_TESTS', 'RUBRIC', 'AI_SUGGESTED_RUBRIC', 'MANUAL', 'MIXED');

-- CreateEnum
CREATE TYPE "GraderType" AS ENUM ('SYSTEM', 'AI', 'INSTRUCTOR', 'TA');

-- CreateEnum
CREATE TYPE "AiMode" AS ENUM ('PROTECTED_ASSESSMENT', 'PRACTICE', 'POST_ASSESSMENT_REVIEW', 'FACULTY_AUTHORING', 'FACULTY_ANALYTICS');

-- CreateEnum
CREATE TYPE "AiProviderName" AS ENUM ('MOCK', 'OPENAI');

-- CreateEnum
CREATE TYPE "AiSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'LIMIT_REACHED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'BLOCKED_BY_POLICY', 'BUDGET_EXCEEDED', 'FALLBACK');

-- CreateEnum
CREATE TYPE "AiErrorClass" AS ENUM ('TIMEOUT', 'RATE_LIMITED', 'AUTH', 'PROVIDER_UNAVAILABLE', 'INVALID_REQUEST', 'CONTENT_FILTER', 'SCHEMA_VALIDATION', 'BUDGET_EXCEEDED', 'KILL_SWITCH', 'NOT_CONFIGURED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ALLOW', 'REVISE', 'BLOCK', 'ESCALATE');

-- CreateEnum
CREATE TYPE "RetrievalMethod" AS ENUM ('VECTOR', 'FULL_TEXT', 'KEYWORD', 'HYBRID');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RetentionClass" AS ENUM ('IDENTITY', 'EDUCATIONAL_RECORD', 'SENSITIVE_CONVERSATION', 'AI_REQUEST_LOG', 'LEARNING_EVIDENCE', 'AGGREGATE', 'RESEARCH', 'SECURITY_AUDIT', 'TRAINING', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "PrivacyClass" AS ENUM ('IDENTITY', 'EDUCATIONAL_RECORD', 'SENSITIVE_CONVERSATION', 'AGGREGATE', 'RESEARCH_PSEUDONYMOUS', 'MODEL_TRAINING_CURATED', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('SUBMISSION', 'CODE_RUN', 'SOCRA_SESSION', 'PRACTICE', 'GRADE', 'MISCONCEPTION_DETECTOR', 'FACULTY');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('FIRST_ATTEMPT_CORRECTNESS', 'FINAL_CORRECTNESS', 'RETRY_IMPROVEMENT', 'SOCRA_USAGE', 'INTERVENTION_DEPTH', 'RECOVERY_AFTER_GUIDANCE', 'MISCONCEPTION_OBSERVED', 'PRACTICE_SUCCESS', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TopicStateLabel" AS ENUM ('NEEDS_REINFORCEMENT', 'DEVELOPING', 'CONSISTENTLY_DEMONSTRATED');

-- CreateEnum
CREATE TYPE "Trajectory" AS ENUM ('IMPROVING', 'STABLE', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "MisconceptionSource" AS ENUM ('FACULTY', 'SEEDED', 'AI_PROPOSED', 'CLUSTER_PROMOTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVISION');

-- CreateEnum
CREATE TYPE "DetectionMethod" AS ENUM ('RULE', 'LLM', 'FACULTY_TAGGED');

-- CreateEnum
CREATE TYPE "PracticeItemSource" AS ENUM ('FACULTY', 'CACHED_GENERATED', 'LIVE_GENERATED');

-- CreateEnum
CREATE TYPE "PracticeItemType" AS ENUM ('CODING', 'SHORT_ANSWER', 'MULTIPLE_CHOICE', 'TRACE', 'EXPLAIN');

-- CreateEnum
CREATE TYPE "PracticeSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('ACCEPTED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "StudyCondition" AS ENUM ('CONTROL', 'UNRESTRICTED_AI', 'SOCRATIC_AI');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('NOT_ASKED', 'CONSENTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'JSON', 'JSONL');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DatasetPurpose" AS ENUM ('RESEARCH', 'TRAINING', 'EVALUATION');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('DRAFT', 'FROZEN', 'EXPORTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "TrainingSourceType" AS ENUM ('EXPERT_DEMONSTRATION', 'LEAKAGE_PREFERENCE_PAIR', 'MISCONCEPTION_LABEL', 'FACULTY_AUTHORING_EXAMPLE', 'SYNTHETIC_ADVERSARIAL', 'AI_MESSAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "DatasetSplit" AS ENUM ('UNASSIGNED', 'TRAIN', 'VALIDATION', 'TEST');

-- CreateEnum
CREATE TYPE "FlagScope" AS ENUM ('ENVIRONMENT', 'COURSE');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('DELETE', 'DEIDENTIFY', 'ARCHIVE', 'KEEP');

-- CreateEnum
CREATE TYPE "RosterImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "RosterRowStatus" AS ENUM ('VALID', 'DUPLICATE', 'INVALID', 'APPLIED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RosterRowAction" AS ENUM ('CREATE_USER', 'ADD_MEMBERSHIP', 'UPDATE_MEMBERSHIP', 'NONE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" "Role"[] DEFAULT ARRAY['STUDENT']::"Role"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT 'local',
    "subject" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "provider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivilegedAccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "PrivilegedPermission" NOT NULL,
    "reason" TEXT NOT NULL,
    "protocolReference" TEXT,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PrivilegedAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "description" TEXT,
    "languages" "ProgrammingLanguage"[],
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSection" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sectionId" TEXT,
    "role" "CourseRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicRelationship" (
    "id" TEXT NOT NULL,
    "fromTopicId" TEXT NOT NULL,
    "toTopicId" TEXT NOT NULL,
    "type" "TopicRelationType" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjective" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjectiveTopic" (
    "objectiveId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "LearningObjectiveTopic_pkey" PRIMARY KEY ("objectiveId","topicId")
);

-- CreateTable
CREATE TABLE "CourseResource" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'PENDING',
    "accessScope" "ResourceAccessScope" NOT NULL DEFAULT 'COURSE_ALL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT,
    "sourceUrl" TEXT,
    "mimeType" TEXT,
    "textContent" TEXT,
    "contentHash" TEXT,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseResourceTopic" (
    "resourceId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "CourseResourceTopic_pkey" PRIMARY KEY ("resourceId","topicId")
);

-- CreateTable
CREATE TABLE "ResourceChunk" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "headingPath" TEXT,
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "embeddedAt" TIMESTAMP(3),
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "format" "AssignmentFormat" NOT NULL,
    "language" "ProgrammingLanguage",
    "state" "AssignmentState" NOT NULL DEFAULT 'DRAFT',
    "openAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "closeAt" TIMESTAMP(3),
    "attemptLimit" INTEGER,
    "allowResubmission" BOOLEAN NOT NULL DEFAULT true,
    "totalPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "solutionReleaseMode" "SolutionReleaseMode" NOT NULL DEFAULT 'MANUAL',
    "solutionsReleased" BOOLEAN NOT NULL DEFAULT false,
    "solutionsReleasedAt" TIMESTAMP(3),
    "resourceScope" "ResourceScopeMode" NOT NULL DEFAULT 'ALL_COURSE_RESOURCES',
    "currentVersionId" TEXT,
    "socraPolicyId" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentVersion" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "policyVersionId" TEXT,
    "changeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "AssignmentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentTopic" (
    "assignmentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "AssignmentTopic_pkey" PRIMARY KEY ("assignmentId","topicId")
);

-- CreateTable
CREATE TABLE "AssignmentLearningObjective" (
    "assignmentId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,

    CONSTRAINT "AssignmentLearningObjective_pkey" PRIMARY KEY ("assignmentId","objectiveId")
);

-- CreateTable
CREATE TABLE "AssignmentResource" (
    "assignmentId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,

    CONSTRAINT "AssignmentResource_pkey" PRIMARY KEY ("assignmentId","resourceId")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "language" "ProgrammingLanguage",
    "starterCode" TEXT,
    "entryPoint" TEXT,
    "referenceSolution" TEXT,
    "choices" JSONB,
    "answerKey" JSONB,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionTopic" (
    "questionId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "QuestionTopic_pkey" PRIMARY KEY ("questionId","topicId")
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT,
    "questionId" TEXT,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricCriterion" (
    "id" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "maxPoints" DOUBLE PRECISION NOT NULL,
    "levels" JSONB,

    CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "TestVisibility" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "harness" JSONB,
    "timeoutMs" INTEGER,
    "failureHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldStage" (
    "id" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "hint" TEXT,

    CONSTRAINT "ScaffoldStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocraPolicy" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocraPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocraPolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "maxInterventionLevel" INTEGER NOT NULL DEFAULT 5,
    "hintLadder" JSONB NOT NULL,
    "allowedBehaviors" JSONB NOT NULL,
    "forbiddenBehaviors" JSONB NOT NULL,
    "allowDirectSyntaxHelp" BOOLEAN NOT NULL DEFAULT true,
    "allowResourceRetrieval" BOOLEAN NOT NULL DEFAULT true,
    "maxTurnsPerSession" INTEGER,
    "maxTurnsPerDay" INTEGER,
    "escalationMessage" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocraPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" "ProgrammingLanguage",
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "clientUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "questionId" TEXT,
    "practiceItemId" TEXT,
    "submissionId" TEXT,
    "kind" "CodeRunKind" NOT NULL DEFAULT 'RUN',
    "language" "ProgrammingLanguage" NOT NULL,
    "status" "CodeRunStatus" NOT NULL DEFAULT 'QUEUED',
    "codeSnapshot" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "stdin" TEXT,
    "stdout" TEXT,
    "stderr" TEXT,
    "exitCode" INTEGER,
    "durationMs" INTEGER,
    "testResults" JSONB,
    "testsPassed" INTEGER,
    "testsTotal" INTEGER,
    "runnerDriver" TEXT,
    "errorClass" TEXT,
    "jobId" TEXT,
    "draftVersion" INTEGER,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CodeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "assignmentVersionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "publicTestSummary" JSONB,
    "researchCondition" "StudyCondition",
    "policyVersion" INTEGER,
    "clientVersion" TEXT,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" "ProgrammingLanguage",
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "SubmissionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT,
    "scope" "GradeScope" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "rawPoints" DOUBLE PRECISION,
    "maxPoints" DOUBLE PRECISION NOT NULL,
    "method" "GradingMethod" NOT NULL,
    "graderType" "GraderType" NOT NULL,
    "status" "GradeStatus" NOT NULL DEFAULT 'PENDING',
    "aiSuggestion" JSONB,
    "facultyOverride" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "feedback" TEXT,
    "criterionScores" JSONB,
    "testsPassed" INTEGER,
    "testsTotal" INTEGER,
    "gradingResults" JSONB,
    "rubricId" TEXT,
    "rubricVersion" INTEGER,
    "graderId" TEXT,
    "gradedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeOverrideAudit" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "previousScore" DOUBLE PRECISION,
    "newScore" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeOverrideAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "latestSubmissionId" TEXT,
    "firstOpenedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL,
    "assignmentId" TEXT,
    "questionId" TEXT,
    "practiceSessionId" TEXT,
    "assignmentVersion" INTEGER,
    "policyVersion" INTEGER,
    "researchCondition" "StudyCondition",
    "status" "AiSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxInterventionLevel" INTEGER NOT NULL DEFAULT 0,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "summary" TEXT,
    "retentionClass" "RetentionClass" NOT NULL DEFAULT 'SENSITIVE_CONVERSATION',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AiSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "interventionLevel" INTEGER,
    "metadata" JSONB,
    "aiRequestId" TEXT,
    "retentionClass" "RetentionClass" NOT NULL DEFAULT 'SENSITIVE_CONVERSATION',
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "courseId" TEXT,
    "assignmentId" TEXT,
    "questionId" TEXT,
    "mode" "AiMode" NOT NULL,
    "task" TEXT NOT NULL,
    "provider" "AiProviderName" NOT NULL,
    "model" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "traceId" TEXT NOT NULL,
    "promptTemplateId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "policyVersion" TEXT,
    "assignmentVersion" INTEGER,
    "questionVersion" INTEGER,
    "researchCondition" "StudyCondition",
    "status" "AiRequestStatus" NOT NULL DEFAULT 'PENDING',
    "errorClass" "AiErrorClass",
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "firstTokenMs" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "appVersion" TEXT NOT NULL,
    "retrievedResourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "structuredOutputValid" BOOLEAN,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "routingReason" TEXT,
    "retentionClass" "RetentionClass" NOT NULL DEFAULT 'AI_REQUEST_LOG',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "aiRequestId" TEXT,
    "messageId" TEXT,
    "mode" "AiMode" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "checker" TEXT NOT NULL,
    "outcome" "PolicyOutcome" NOT NULL,
    "checks" JSONB NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interventionLevel" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelConfiguration" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT 'global',
    "courseId" TEXT,
    "provider" "AiProviderName" NOT NULL DEFAULT 'OPENAI',
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "maxOutputTokens" INTEGER,
    "reasoningEffort" TEXT,
    "inputPricePer1M" DECIMAL(10,4) NOT NULL,
    "cachedInputPricePer1M" DECIMAL(10,4) NOT NULL,
    "outputPricePer1M" DECIMAL(10,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAiBudget" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "budgetUsd" DECIMAL(12,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "alertThresholdPct" INTEGER NOT NULL DEFAULT 80,
    "hardStop" BOOLEAN NOT NULL DEFAULT true,
    "aiDisabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseAiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetrievalCitation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "aiRequestId" TEXT,
    "messageId" TEXT,
    "resourceId" TEXT NOT NULL,
    "chunkId" TEXT,
    "resourceVersion" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "method" "RetrievalMethod" NOT NULL,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetrievalCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptAccessLog" (
    "id" TEXT NOT NULL,
    "accessorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "grantId" TEXT,
    "reason" TEXT NOT NULL,
    "ip" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocraEscalation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "questionId" TEXT,
    "note" TEXT,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SocraEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthoringSuggestion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "kind" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "aiRequestId" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AuthoringSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingBrief" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "metricsSnapshot" JSONB NOT NULL,
    "aiRequestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "assignmentVersion" INTEGER,
    "questionId" TEXT,
    "questionVersion" INTEGER,
    "practiceItemId" TEXT,
    "aiSessionId" TEXT,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceId" TEXT,
    "evidenceType" "EvidenceType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rawValue" JSONB,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "assisted" BOOLEAN NOT NULL DEFAULT false,
    "maxInterventionLevel" INTEGER,
    "difficulty" INTEGER,
    "attemptNumber" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "modelVersion" TEXT,
    "detectorVersion" TEXT,
    "policyVersion" TEXT,
    "researchCondition" "StudyCondition",
    "sourceEventId" TEXT,
    "sourceEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,

    CONSTRAINT "LearningEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerTopicState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "state" "TopicStateLabel" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "trajectory" "Trajectory" NOT NULL DEFAULT 'STABLE',
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistanceDependency" DOUBLE PRECISION,
    "firstAttemptRate" DOUBLE PRECISION,
    "lastEvidenceAt" TIMESTAMP(3),
    "lastDemonstratedAt" TIMESTAMP(3),
    "commonDifficulty" TEXT,
    "misconceptionSummary" JSONB,
    "explanation" TEXT,
    "algorithmVersion" TEXT NOT NULL,
    "computedAsOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerTopicState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Misconception" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "MisconceptionSource" NOT NULL DEFAULT 'FACULTY',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "taxonomyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Misconception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisconceptionObservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "misconceptionId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "questionId" TEXT,
    "submissionId" TEXT,
    "codeRunId" TEXT,
    "aiSessionId" TEXT,
    "practiceAttemptId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "detectionMethod" "DetectionMethod" NOT NULL,
    "detectionVersion" TEXT NOT NULL,
    "modelVersion" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "sourceEventId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MisconceptionObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeItem" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "type" "PracticeItemType" NOT NULL,
    "language" "ProgrammingLanguage",
    "prompt" TEXT NOT NULL,
    "starterCode" TEXT,
    "answer" TEXT,
    "explanation" TEXT,
    "choices" JSONB,
    "rubric" JSONB,
    "tests" JSONB,
    "source" "PracticeItemSource" NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "generationModel" TEXT,
    "generationPromptVersion" TEXT,
    "generationRequestId" TEXT,
    "targetedMisconceptionId" TEXT,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT,
    "status" "PracticeSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentDifficulty" INTEGER NOT NULL DEFAULT 2,
    "itemsServed" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "researchCondition" "StudyCondition",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeItemAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answer" TEXT,
    "isCorrect" BOOLEAN,
    "score" DOUBLE PRECISION,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "difficulty" INTEGER NOT NULL,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "explanationRequested" BOOLEAN NOT NULL DEFAULT false,
    "assisted" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "gradedBy" TEXT,
    "idempotencyKey" TEXT,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "PracticeItemAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "actorId" TEXT,
    "pseudonymousId" TEXT,
    "courseId" TEXT,
    "sectionId" TEXT,
    "assignmentId" TEXT,
    "assignmentVersion" INTEGER,
    "questionId" TEXT,
    "questionVersion" INTEGER,
    "sessionId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appVersion" TEXT NOT NULL,
    "researchCondition" "StudyCondition",
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sourceTraceId" TEXT,
    "privacyClass" "PrivacyClass" NOT NULL DEFAULT 'EDUCATIONAL_RECORD',
    "status" "EventStatus" NOT NULL DEFAULT 'ACCEPTED',
    "quarantineReason" TEXT,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAggregate" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "metricVersion" INTEGER NOT NULL DEFAULT 1,
    "windowKey" TEXT NOT NULL DEFAULT 'all',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "segment" TEXT NOT NULL DEFAULT 'all',
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "metric" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAggregate" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "metricVersion" INTEGER NOT NULL DEFAULT 1,
    "windowKey" TEXT NOT NULL DEFAULT 'all',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "segment" TEXT NOT NULL DEFAULT 'all',
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "metric" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionAggregate" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "metricVersion" INTEGER NOT NULL DEFAULT 1,
    "windowKey" TEXT NOT NULL DEFAULT 'all',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "segment" TEXT NOT NULL DEFAULT 'all',
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "metric" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicAggregate" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "metricVersion" INTEGER NOT NULL DEFAULT 1,
    "windowKey" TEXT NOT NULL DEFAULT 'all',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "segment" TEXT NOT NULL DEFAULT 'all',
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "metric" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisconceptionAggregate" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "misconceptionId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL DEFAULT '',
    "metricKey" TEXT NOT NULL,
    "metricVersion" INTEGER NOT NULL DEFAULT 1,
    "windowKey" TEXT NOT NULL DEFAULT 'all',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "segment" TEXT NOT NULL DEFAULT 'all',
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "detectorVersions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "metric" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MisconceptionAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyParticipant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "pseudonymousId" TEXT NOT NULL,
    "condition" "StudyCondition" NOT NULL,
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'NOT_ASKED',
    "consentBasis" TEXT,
    "conditionLocked" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "assignmentMethod" TEXT NOT NULL DEFAULT 'admin-manual',
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyConditionChange" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "fromCondition" "StudyCondition" NOT NULL,
    "toCondition" "StudyCondition" NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyConditionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchParticipantMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'hmac-sha256',
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchParticipantMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchEvent" (
    "id" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "participantId" TEXT,
    "eventName" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "condition" "StudyCondition",
    "courseId" TEXT,
    "assignmentId" TEXT,
    "assignmentVersion" INTEGER,
    "questionId" TEXT,
    "questionVersion" INTEGER,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "approvedPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetManifest" (
    "id" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" "DatasetPurpose" NOT NULL,
    "owner" TEXT NOT NULL,
    "sourceSystems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceWindowStart" TIMESTAMP(3),
    "sourceWindowEnd" TIMESTAMP(3),
    "eligibleCohort" TEXT,
    "policyBasis" TEXT,
    "rowGrain" TEXT,
    "fieldsIncluded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fieldsExcluded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inclusionRules" JSONB,
    "exclusionRules" JSONB,
    "deidentificationTransformations" JSONB,
    "deidentificationVersion" TEXT,
    "labelingMethod" TEXT,
    "qualityReviewProcedure" TEXT,
    "dedupMethod" TEXT,
    "splitRule" TEXT,
    "knownLimitations" TEXT,
    "codeVersion" TEXT NOT NULL,
    "queryVersion" TEXT,
    "modelVersions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promptVersions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "retentionRule" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "DatasetManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchExport" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "courseId" TEXT,
    "filters" JSONB NOT NULL,
    "fields" TEXT[],
    "format" "ExportFormat" NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'REQUESTED',
    "purpose" TEXT NOT NULL DEFAULT 'research',
    "manifestId" TEXT,
    "rowCount" INTEGER,
    "checksum" TEXT,
    "filePath" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCandidate" (
    "id" TEXT NOT NULL,
    "sourceType" "TrainingSourceType" NOT NULL,
    "sourceTable" TEXT,
    "sourceId" TEXT,
    "courseId" TEXT,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "trainingEligible" BOOLEAN NOT NULL DEFAULT false,
    "trainingEligibilityReason" TEXT,
    "consentBasis" TEXT,
    "deidentifiedAt" TIMESTAMP(3),
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "datasetSplit" "DatasetSplit" NOT NULL DEFAULT 'UNASSIGNED',
    "sourceModelVersion" TEXT,
    "sourcePromptVersion" TEXT,
    "gatePolicyAllowed" BOOLEAN NOT NULL DEFAULT false,
    "gateDeidentified" BOOLEAN NOT NULL DEFAULT false,
    "gatePiiSecretScanPassed" BOOLEAN NOT NULL DEFAULT false,
    "gateHiddenTestLeakagePassed" BOOLEAN NOT NULL DEFAULT false,
    "gateCopyrightAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "gateQualityReviewed" BOOLEAN NOT NULL DEFAULT false,
    "gateDeduplicated" BOOLEAN NOT NULL DEFAULT false,
    "gateContaminationCheckPassed" BOOLEAN NOT NULL DEFAULT false,
    "gateDatasetVersioned" BOOLEAN NOT NULL DEFAULT false,
    "datasetVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" "DatasetPurpose" NOT NULL,
    "status" "DatasetStatus" NOT NULL DEFAULT 'DRAFT',
    "manifestId" TEXT,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "filePath" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeldOutEvalItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL,
    "input" JSONB NOT NULL,
    "expectedBehavior" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'synthetic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeldOutEvalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "FlagScope" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "courseId" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "courseId" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJobFailure" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT,
    "payload" JSONB,
    "error" TEXT NOT NULL,
    "stack" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "BackgroundJobFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "category" "RetentionClass" NOT NULL,
    "retentionDays" INTEGER,
    "action" "RetentionAction" NOT NULL DEFAULT 'KEEP',
    "description" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterImport" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sectionId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "RosterImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "RosterImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "role" "CourseRole",
    "sectionCode" TEXT,
    "status" "RosterRowStatus" NOT NULL,
    "action" "RosterRowAction" NOT NULL DEFAULT 'NONE',
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,

    CONSTRAINT "RosterImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_issuer_subject_key" ON "AuthIdentity"("provider", "issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "PrivilegedAccessGrant_userId_permission_idx" ON "PrivilegedAccessGrant"("userId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSection_courseId_code_key" ON "CourseSection"("courseId", "code");

-- CreateIndex
CREATE INDEX "CourseMembership_courseId_role_status_idx" ON "CourseMembership"("courseId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseMembership_userId_courseId_key" ON "CourseMembership"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_courseId_key_key" ON "Topic"("courseId", "key");

-- CreateIndex
CREATE INDEX "TopicRelationship_toTopicId_idx" ON "TopicRelationship"("toTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "TopicRelationship_fromTopicId_toTopicId_type_key" ON "TopicRelationship"("fromTopicId", "toTopicId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObjective_courseId_code_key" ON "LearningObjective"("courseId", "code");

-- CreateIndex
CREATE INDEX "LearningObjectiveTopic_topicId_idx" ON "LearningObjectiveTopic"("topicId");

-- CreateIndex
CREATE INDEX "CourseResource_courseId_status_accessScope_idx" ON "CourseResource"("courseId", "status", "accessScope");

-- CreateIndex
CREATE INDEX "CourseResourceTopic_topicId_idx" ON "CourseResourceTopic"("topicId");

-- CreateIndex
CREATE INDEX "ResourceChunk_courseId_idx" ON "ResourceChunk"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceChunk_resourceId_sourceVersion_chunkIndex_key" ON "ResourceChunk"("resourceId", "sourceVersion", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_currentVersionId_key" ON "Assignment"("currentVersionId");

-- CreateIndex
CREATE INDEX "Assignment_courseId_state_idx" ON "Assignment"("courseId", "state");

-- CreateIndex
CREATE INDEX "Assignment_state_closeAt_idx" ON "Assignment"("state", "closeAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentVersion_assignmentId_version_key" ON "AssignmentVersion"("assignmentId", "version");

-- CreateIndex
CREATE INDEX "AssignmentTopic_topicId_idx" ON "AssignmentTopic"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_currentVersionId_key" ON "Question"("currentVersionId");

-- CreateIndex
CREATE INDEX "Question_assignmentId_order_idx" ON "Question"("assignmentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE INDEX "QuestionTopic_topicId_idx" ON "QuestionTopic"("topicId");

-- CreateIndex
CREATE INDEX "Rubric_assignmentId_idx" ON "Rubric"("assignmentId");

-- CreateIndex
CREATE INDEX "Rubric_questionId_idx" ON "Rubric"("questionId");

-- CreateIndex
CREATE INDEX "RubricCriterion_rubricId_idx" ON "RubricCriterion"("rubricId");

-- CreateIndex
CREATE INDEX "TestCase_questionVersionId_visibility_idx" ON "TestCase"("questionVersionId", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "ScaffoldStage_questionVersionId_order_key" ON "ScaffoldStage"("questionVersionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SocraPolicy_currentVersionId_key" ON "SocraPolicy"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SocraPolicyVersion_policyId_version_key" ON "SocraPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE INDEX "Draft_assignmentId_idx" ON "Draft"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_userId_questionId_key" ON "Draft"("userId", "questionId");

-- CreateIndex
CREATE INDEX "CodeRun_userId_questionId_queuedAt_idx" ON "CodeRun"("userId", "questionId", "queuedAt");

-- CreateIndex
CREATE INDEX "CodeRun_assignmentId_idx" ON "CodeRun"("assignmentId");

-- CreateIndex
CREATE INDEX "CodeRun_status_idx" ON "CodeRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_idempotencyKey_key" ON "Submission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Submission_assignmentId_submittedAt_idx" ON "Submission"("assignmentId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_userId_assignmentId_attemptNumber_key" ON "Submission"("userId", "assignmentId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAnswer_submissionId_questionId_key" ON "SubmissionAnswer"("submissionId", "questionId");

-- CreateIndex
CREATE INDEX "Grade_status_idx" ON "Grade"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_submissionId_scopeKey_key" ON "Grade"("submissionId", "scopeKey");

-- CreateIndex
CREATE INDEX "GradeOverrideAudit_gradeId_idx" ON "GradeOverrideAudit"("gradeId");

-- CreateIndex
CREATE INDEX "AssignmentProgress_assignmentId_status_idx" ON "AssignmentProgress"("assignmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentProgress_userId_assignmentId_key" ON "AssignmentProgress"("userId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSession_practiceSessionId_key" ON "AiSession"("practiceSessionId");

-- CreateIndex
CREATE INDEX "AiSession_userId_assignmentId_startedAt_idx" ON "AiSession"("userId", "assignmentId", "startedAt");

-- CreateIndex
CREATE INDEX "AiSession_courseId_mode_startedAt_idx" ON "AiSession"("courseId", "mode", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessage_aiRequestId_key" ON "AiMessage"("aiRequestId");

-- CreateIndex
CREATE INDEX "AiMessage_sessionId_createdAt_idx" ON "AiMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_courseId_createdAt_idx" ON "AiRequest"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_userId_createdAt_idx" ON "AiRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_mode_status_createdAt_idx" ON "AiRequest"("mode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyDecision_sessionId_idx" ON "PolicyDecision"("sessionId");

-- CreateIndex
CREATE INDEX "PolicyDecision_outcome_createdAt_idx" ON "PolicyDecision"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "PromptVersion_mode_isActive_idx" ON "PromptVersion"("mode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_templateId_version_key" ON "PromptVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ModelConfiguration_key_scopeKey_key" ON "ModelConfiguration"("key", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAiBudget_courseId_key" ON "CourseAiBudget"("courseId");

-- CreateIndex
CREATE INDEX "RetrievalCitation_resourceId_idx" ON "RetrievalCitation"("resourceId");

-- CreateIndex
CREATE INDEX "RetrievalCitation_sessionId_idx" ON "RetrievalCitation"("sessionId");

-- CreateIndex
CREATE INDEX "TranscriptAccessLog_accessorId_accessedAt_idx" ON "TranscriptAccessLog"("accessorId", "accessedAt");

-- CreateIndex
CREATE INDEX "TranscriptAccessLog_targetUserId_idx" ON "TranscriptAccessLog"("targetUserId");

-- CreateIndex
CREATE INDEX "SocraEscalation_courseId_status_idx" ON "SocraEscalation"("courseId", "status");

-- CreateIndex
CREATE INDEX "AuthoringSuggestion_courseId_createdAt_idx" ON "AuthoringSuggestion"("courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingBrief_courseId_weekStart_key" ON "TeachingBrief"("courseId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "LearningEvidence_idempotencyKey_key" ON "LearningEvidence"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LearningEvidence_userId_topicId_occurredAt_idx" ON "LearningEvidence"("userId", "topicId", "occurredAt");

-- CreateIndex
CREATE INDEX "LearningEvidence_courseId_topicId_idx" ON "LearningEvidence"("courseId", "topicId");

-- CreateIndex
CREATE INDEX "LearningEvidence_assignmentId_idx" ON "LearningEvidence"("assignmentId");

-- CreateIndex
CREATE INDEX "LearningEvidence_questionId_idx" ON "LearningEvidence"("questionId");

-- CreateIndex
CREATE INDEX "LearningEvidence_sourceEventId_idx" ON "LearningEvidence"("sourceEventId");

-- CreateIndex
CREATE INDEX "LearnerTopicState_courseId_topicId_state_idx" ON "LearnerTopicState"("courseId", "topicId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerTopicState_userId_topicId_key" ON "LearnerTopicState"("userId", "topicId");

-- CreateIndex
CREATE INDEX "Misconception_topicId_idx" ON "Misconception"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "Misconception_courseId_key_key" ON "Misconception"("courseId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MisconceptionObservation_idempotencyKey_key" ON "MisconceptionObservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MisconceptionObservation_courseId_misconceptionId_idx" ON "MisconceptionObservation"("courseId", "misconceptionId");

-- CreateIndex
CREATE INDEX "MisconceptionObservation_userId_topicId_idx" ON "MisconceptionObservation"("userId", "topicId");

-- CreateIndex
CREATE INDEX "MisconceptionObservation_assignmentId_questionId_idx" ON "MisconceptionObservation"("assignmentId", "questionId");

-- CreateIndex
CREATE INDEX "PracticeItem_courseId_topicId_difficulty_reviewStatus_idx" ON "PracticeItem"("courseId", "topicId", "difficulty", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeItem_courseId_contentHash_key" ON "PracticeItem"("courseId", "contentHash");

-- CreateIndex
CREATE INDEX "PracticeSession_userId_startedAt_idx" ON "PracticeSession"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeItemAttempt_idempotencyKey_key" ON "PracticeItemAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PracticeItemAttempt_sessionId_idx" ON "PracticeItemAttempt"("sessionId");

-- CreateIndex
CREATE INDEX "PracticeItemAttempt_userId_itemId_idx" ON "PracticeItemAttempt"("userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_idempotencyKey_key" ON "AnalyticsEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_occurredAt_idx" ON "AnalyticsEvent"("eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_courseId_eventName_occurredAt_idx" ON "AnalyticsEvent"("courseId", "eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_actorId_occurredAt_idx" ON "AnalyticsEvent"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_assignmentId_eventName_idx" ON "AnalyticsEvent"("assignmentId", "eventName");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_status_idx" ON "AnalyticsEvent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_eventId_key" ON "OutboxEvent"("eventId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEvent_consumer_eventId_key" ON "ProcessedEvent"("consumer", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAggregate_courseId_metricKey_windowKey_segment_key" ON "CourseAggregate"("courseId", "metricKey", "windowKey", "segment");

-- CreateIndex
CREATE INDEX "AssignmentAggregate_courseId_idx" ON "AssignmentAggregate"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentAggregate_assignmentId_metricKey_windowKey_segmen_key" ON "AssignmentAggregate"("assignmentId", "metricKey", "windowKey", "segment");

-- CreateIndex
CREATE INDEX "QuestionAggregate_courseId_idx" ON "QuestionAggregate"("courseId");

-- CreateIndex
CREATE INDEX "QuestionAggregate_assignmentId_idx" ON "QuestionAggregate"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAggregate_questionId_metricKey_windowKey_segment_key" ON "QuestionAggregate"("questionId", "metricKey", "windowKey", "segment");

-- CreateIndex
CREATE INDEX "TopicAggregate_courseId_idx" ON "TopicAggregate"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "TopicAggregate_topicId_metricKey_windowKey_segment_key" ON "TopicAggregate"("topicId", "metricKey", "windowKey", "segment");

-- CreateIndex
CREATE INDEX "MisconceptionAggregate_courseId_idx" ON "MisconceptionAggregate"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "MisconceptionAggregate_misconceptionId_assignmentId_metricK_key" ON "MisconceptionAggregate"("misconceptionId", "assignmentId", "metricKey", "windowKey", "segment");

-- CreateIndex
CREATE INDEX "StudyParticipant_pseudonymousId_idx" ON "StudyParticipant"("pseudonymousId");

-- CreateIndex
CREATE INDEX "StudyParticipant_courseId_condition_idx" ON "StudyParticipant"("courseId", "condition");

-- CreateIndex
CREATE UNIQUE INDEX "StudyParticipant_userId_courseId_key" ON "StudyParticipant"("userId", "courseId");

-- CreateIndex
CREATE INDEX "StudyConditionChange_participantId_idx" ON "StudyConditionChange"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchParticipantMapping_userId_key" ON "ResearchParticipantMapping"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchParticipantMapping_participantId_key" ON "ResearchParticipantMapping"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEvent_sourceEventId_key" ON "ResearchEvent"("sourceEventId");

-- CreateIndex
CREATE INDEX "ResearchEvent_participantId_eventTime_idx" ON "ResearchEvent"("participantId", "eventTime");

-- CreateIndex
CREATE INDEX "ResearchEvent_courseId_eventName_eventTime_idx" ON "ResearchEvent"("courseId", "eventName", "eventTime");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetManifest_datasetKey_version_key" ON "DatasetManifest"("datasetKey", "version");

-- CreateIndex
CREATE INDEX "ResearchExport_requestedById_createdAt_idx" ON "ResearchExport"("requestedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCandidate_contentHash_key" ON "TrainingCandidate"("contentHash");

-- CreateIndex
CREATE INDEX "TrainingCandidate_trainingEligible_reviewStatus_idx" ON "TrainingCandidate"("trainingEligible", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetVersion_name_version_key" ON "DatasetVersion"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HeldOutEvalItem_key_key" ON "HeldOutEvalItem"("key");

-- CreateIndex
CREATE UNIQUE INDEX "HeldOutEvalItem_contentHash_key" ON "HeldOutEvalItem"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_scopeKey_key" ON "FeatureFlag"("key", "scopeKey");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_courseId_createdAt_idx" ON "AuditLog"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJobFailure_queue_failedAt_idx" ON "BackgroundJobFailure"("queue", "failedAt");

-- CreateIndex
CREATE INDEX "BackgroundJobFailure_resolvedAt_idx" ON "BackgroundJobFailure"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_category_key" ON "RetentionPolicy"("category");

-- CreateIndex
CREATE INDEX "RosterImport_courseId_createdAt_idx" ON "RosterImport"("courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RosterImportRow_importId_rowNumber_key" ON "RosterImportRow"("importId", "rowNumber");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivilegedAccessGrant" ADD CONSTRAINT "PrivilegedAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivilegedAccessGrant" ADD CONSTRAINT "PrivilegedAccessGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSection" ADD CONSTRAINT "CourseSection_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRelationship" ADD CONSTRAINT "TopicRelationship_fromTopicId_fkey" FOREIGN KEY ("fromTopicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRelationship" ADD CONSTRAINT "TopicRelationship_toTopicId_fkey" FOREIGN KEY ("toTopicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjective" ADD CONSTRAINT "LearningObjective_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveTopic" ADD CONSTRAINT "LearningObjectiveTopic_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "LearningObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveTopic" ADD CONSTRAINT "LearningObjectiveTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResource" ADD CONSTRAINT "CourseResource_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResourceTopic" ADD CONSTRAINT "CourseResourceTopic_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CourseResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResourceTopic" ADD CONSTRAINT "CourseResourceTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceChunk" ADD CONSTRAINT "ResourceChunk_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CourseResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "AssignmentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_socraPolicyId_fkey" FOREIGN KEY ("socraPolicyId") REFERENCES "SocraPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentVersion" ADD CONSTRAINT "AssignmentVersion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentTopic" ADD CONSTRAINT "AssignmentTopic_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentTopic" ADD CONSTRAINT "AssignmentTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentLearningObjective" ADD CONSTRAINT "AssignmentLearningObjective_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentLearningObjective" ADD CONSTRAINT "AssignmentLearningObjective_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "LearningObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentResource" ADD CONSTRAINT "AssignmentResource_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentResource" ADD CONSTRAINT "AssignmentResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CourseResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "QuestionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldStage" ADD CONSTRAINT "ScaffoldStage_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocraPolicy" ADD CONSTRAINT "SocraPolicy_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocraPolicy" ADD CONSTRAINT "SocraPolicy_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "SocraPolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocraPolicyVersion" ADD CONSTRAINT "SocraPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SocraPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRun" ADD CONSTRAINT "CodeRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRun" ADD CONSTRAINT "CodeRun_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRun" ADD CONSTRAINT "CodeRun_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRun" ADD CONSTRAINT "CodeRun_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentVersionId_fkey" FOREIGN KEY ("assignmentVersionId") REFERENCES "AssignmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_graderId_fkey" FOREIGN KEY ("graderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeOverrideAudit" ADD CONSTRAINT "GradeOverrideAudit_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeOverrideAudit" ADD CONSTRAINT "GradeOverrideAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentProgress" ADD CONSTRAINT "AssignmentProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentProgress" ADD CONSTRAINT "AssignmentProgress_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSession" ADD CONSTRAINT "AiSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSession" ADD CONSTRAINT "AiSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSession" ADD CONSTRAINT "AiSession_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSession" ADD CONSTRAINT "AiSession_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSession" ADD CONSTRAINT "AiSession_practiceSessionId_fkey" FOREIGN KEY ("practiceSessionId") REFERENCES "PracticeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_aiRequestId_fkey" FOREIGN KEY ("aiRequestId") REFERENCES "AiRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_aiRequestId_fkey" FOREIGN KEY ("aiRequestId") REFERENCES "AiRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAiBudget" ADD CONSTRAINT "CourseAiBudget_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalCitation" ADD CONSTRAINT "RetrievalCitation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalCitation" ADD CONSTRAINT "RetrievalCitation_aiRequestId_fkey" FOREIGN KEY ("aiRequestId") REFERENCES "AiRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalCitation" ADD CONSTRAINT "RetrievalCitation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalCitation" ADD CONSTRAINT "RetrievalCitation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CourseResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalCitation" ADD CONSTRAINT "RetrievalCitation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ResourceChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptAccessLog" ADD CONSTRAINT "TranscriptAccessLog_accessorId_fkey" FOREIGN KEY ("accessorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptAccessLog" ADD CONSTRAINT "TranscriptAccessLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocraEscalation" ADD CONSTRAINT "SocraEscalation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocraEscalation" ADD CONSTRAINT "SocraEscalation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthoringSuggestion" ADD CONSTRAINT "AuthoringSuggestion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingBrief" ADD CONSTRAINT "TeachingBrief_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEvidence" ADD CONSTRAINT "LearningEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEvidence" ADD CONSTRAINT "LearningEvidence_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerTopicState" ADD CONSTRAINT "LearnerTopicState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerTopicState" ADD CONSTRAINT "LearnerTopicState_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerTopicState" ADD CONSTRAINT "LearnerTopicState_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Misconception" ADD CONSTRAINT "Misconception_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Misconception" ADD CONSTRAINT "Misconception_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisconceptionObservation" ADD CONSTRAINT "MisconceptionObservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisconceptionObservation" ADD CONSTRAINT "MisconceptionObservation_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisconceptionObservation" ADD CONSTRAINT "MisconceptionObservation_misconceptionId_fkey" FOREIGN KEY ("misconceptionId") REFERENCES "Misconception"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_targetedMisconceptionId_fkey" FOREIGN KEY ("targetedMisconceptionId") REFERENCES "Misconception"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemAttempt" ADD CONSTRAINT "PracticeItemAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemAttempt" ADD CONSTRAINT "PracticeItemAttempt_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemAttempt" ADD CONSTRAINT "PracticeItemAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyParticipant" ADD CONSTRAINT "StudyParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyParticipant" ADD CONSTRAINT "StudyParticipant_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyConditionChange" ADD CONSTRAINT "StudyConditionChange_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "StudyParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchParticipantMapping" ADD CONSTRAINT "ResearchParticipantMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchExport" ADD CONSTRAINT "ResearchExport_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchExport" ADD CONSTRAINT "ResearchExport_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "DatasetManifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCandidate" ADD CONSTRAINT "TrainingCandidate_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "DatasetManifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterImport" ADD CONSTRAINT "RosterImport_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterImport" ADD CONSTRAINT "RosterImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterImportRow" ADD CONSTRAINT "RosterImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RosterImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
