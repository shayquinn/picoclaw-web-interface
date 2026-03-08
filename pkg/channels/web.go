// PicoClaw - Ultra-lightweight personal AI agent
// License: MIT
//
// Copyright (c) 2026 PicoClaw contributors

package channels

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
)

// WebChannel provides an HTTP REST API for the web interface to communicate
// with PicoClaw. It listens on a configurable host/port and exposes:
//   - POST /api/chat  — send a message and receive a response
//   - GET  /health    — liveness check
type WebChannel struct {
	*BaseChannel
	config    config.WebConfig
	server    *http.Server
	pendingMu sync.Mutex
	pending   map[string]chan string // chat_id -> response channel
}

type webChatRequest struct {
	Message string `json:"message"`
	ChatID  string `json:"chat_id,omitempty"`
}

type webChatResponse struct {
	Success  bool   `json:"success"`
	Response string `json:"response"`
	ChatID   string `json:"chat_id"`
}

func NewWebChannel(cfg config.WebConfig, msgBus *bus.MessageBus) (*WebChannel, error) {
	base := NewBaseChannel("web", cfg, msgBus, cfg.AllowFrom)
	return &WebChannel{
		BaseChannel: base,
		config:      cfg,
		pending:     make(map[string]chan string),
	}, nil
}

func (c *WebChannel) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/chat", c.handleChat)
	mux.HandleFunc("/health", c.handleHealth)

	addr := fmt.Sprintf("%s:%d", c.config.Host, c.config.Port)
	c.server = &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 120 * time.Second,
	}

	c.SetRunning(true)

	logger.InfoCF("web", "Web channel HTTP server starting", map[string]any{
		"addr": addr,
	})

	go func() {
		if err := c.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.ErrorCF("web", "Web channel server error", map[string]any{"error": err.Error()})
			c.SetRunning(false)
		}
	}()

	return nil
}

func (c *WebChannel) Stop(ctx context.Context) error {
	c.SetRunning(false)
	if c.server != nil {
		return c.server.Shutdown(ctx)
	}
	return nil
}

// Send is called by the channel manager when the agent has a response for this channel.
// It wakes up the pending HTTP handler waiting for the given chat_id.
func (c *WebChannel) Send(_ context.Context, msg bus.OutboundMessage) error {
	c.pendingMu.Lock()
	ch, exists := c.pending[msg.ChatID]
	c.pendingMu.Unlock()

	if exists {
		select {
		case ch <- msg.Content:
		default:
			// Handler already timed out; discard
		}
	}

	return nil
}

func (c *WebChannel) setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func (c *WebChannel) handleHealth(w http.ResponseWriter, r *http.Request) {
	c.setCORSHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (c *WebChannel) handleChat(w http.ResponseWriter, r *http.Request) {
	c.setCORSHeaders(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req webChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Message == "" {
		http.Error(w, "message field is required", http.StatusBadRequest)
		return
	}

	if req.ChatID == "" {
		req.ChatID = "web-default"
	}

	// Register a pending response channel keyed to this chat_id.
	respCh := make(chan string, 1)
	c.pendingMu.Lock()
	c.pending[req.ChatID] = respCh
	c.pendingMu.Unlock()

	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, req.ChatID)
		c.pendingMu.Unlock()
	}()

	// Publish the inbound message to the agent via the message bus.
	c.HandleMessage(r.Context(), bus.Peer{}, "", "web-user", req.ChatID, req.Message, nil, nil)

	// Wait for the agent to respond, with a 120-second timeout.
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	w.Header().Set("Content-Type", "application/json")

	select {
	case response := <-respCh:
		_ = json.NewEncoder(w).Encode(webChatResponse{
			Success:  true,
			Response: response,
			ChatID:   req.ChatID,
		})
	case <-ctx.Done():
		w.WriteHeader(http.StatusGatewayTimeout)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Request timed out waiting for agent response"})
	}
}
