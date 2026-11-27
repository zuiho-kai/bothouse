package core

import "github.com/chenhg5/cc-connect/core/model"

// The types platforms render live in core/model; core keeps their names.
type (
	TaskState             = model.TaskState
	FactStage             = model.FactStage
	TaskEventKind         = model.TaskEventKind
	TaskEvent             = model.TaskEvent
	Task                  = model.Task
	TaskArtifactRole      = model.TaskArtifactRole
	TaskArtifact          = model.TaskArtifact
	TaskMember            = model.TaskMember
	TaskTextPart          = model.TaskTextPart
	TaskTextDelivery      = model.TaskTextDelivery
	SubTaskStatus         = model.SubTaskStatus
	SubTask               = model.SubTask
	ProgressCardEntryKind = model.ProgressCardEntryKind
	ProgressCardEntry     = model.ProgressCardEntry
	TaskForum             = model.TaskForum
	TaskForumPost         = model.TaskForumPost
	TaskForumPoster       = model.TaskForumPoster
	ChannelBoardPoster    = model.ChannelBoardPoster
	TeamChannel           = model.TeamChannel
	TeamArchivedMessage   = model.TeamArchivedMessage
	Moment                = model.Moment
)

const (
	TaskStateReceived           = model.TaskStateReceived
	TaskStateInProgress         = model.TaskStateInProgress
	TaskStateWaitingUser        = model.TaskStateWaitingUser
	TaskStateFailed             = model.TaskStateFailed
	TaskStateCancelled          = model.TaskStateCancelled
	TaskStateResultReady        = model.TaskStateResultReady
	TaskStateCompleted          = model.TaskStateCompleted
	FactStageReceived           = model.FactStageReceived
	FactStageCodeModified       = model.FactStageCodeModified
	FactStagePROpened           = model.FactStagePROpened
	FactStageCIPassed           = model.FactStageCIPassed
	FactStageMerged             = model.FactStageMerged
	FactStageDeployed           = model.FactStageDeployed
	FactStageVerified           = model.FactStageVerified
	TaskEventCreated            = model.TaskEventCreated
	TaskEventRequirementChanged = model.TaskEventRequirementChanged
	TaskEventProgress           = model.TaskEventProgress
	TaskEventFactUpdated        = model.TaskEventFactUpdated
	TaskEventWaitingUser        = model.TaskEventWaitingUser
	TaskEventBlocked            = model.TaskEventBlocked
	TaskEventFailed             = model.TaskEventFailed
	TaskEventResultReady        = model.TaskEventResultReady
	TaskEventCompleted          = model.TaskEventCompleted
	TaskArtifactInput           = model.TaskArtifactInput
	TaskArtifactOutput          = model.TaskArtifactOutput
	SubTaskRunning              = model.SubTaskRunning
	SubTaskWaiting              = model.SubTaskWaiting
	SubTaskCompleted            = model.SubTaskCompleted
	SubTaskFailed               = model.SubTaskFailed
	SubTaskStopped              = model.SubTaskStopped
	ProgressEntryInfo           = model.ProgressEntryInfo
	ProgressEntryThinking       = model.ProgressEntryThinking
	ProgressEntryToolUse        = model.ProgressEntryToolUse
	ProgressEntryToolResult     = model.ProgressEntryToolResult
	ProgressEntryError          = model.ProgressEntryError
)
