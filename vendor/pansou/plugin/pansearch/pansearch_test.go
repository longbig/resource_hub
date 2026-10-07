package pansearch

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWorkerPoolCloseIsIdempotentAndPreservesOutputs(t *testing.T) {
	const (
		taskCount   = 24
		workerCount = 4
	)

	pool := NewWorkerPool(workerCount, taskCount)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool.Start(ctx, func(ctx context.Context, task Task) (TaskResult, error) {
		time.Sleep(5 * time.Millisecond)
		if task.offset%2 == 0 {
			return TaskResult{
				offset: task.offset,
				results: []PanSearchItem{
					{ID: task.offset},
				},
			}, nil
		}

		return TaskResult{}, fmt.Errorf("task %d failed", task.offset)
	})

	for i := 0; i < taskCount; i++ {
		if ok := pool.Submit(Task{offset: i}); !ok {
			t.Fatalf("submit task %d failed", i)
		}
	}

	closeDone := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		go func() {
			pool.Close()
			closeDone <- struct{}{}
		}()
	}

	resultCount := 0
	for result := range pool.results {
		if len(result.results) != 1 {
			t.Fatalf("unexpected result payload for offset %d", result.offset)
		}
		resultCount++
	}

	errorCount := 0
	for err := range pool.errors {
		if err == nil {
			t.Fatal("received nil error from worker pool")
		}
		errorCount++
	}

	if resultCount != taskCount/2 {
		t.Fatalf("unexpected result count: got %d want %d", resultCount, taskCount/2)
	}
	if errorCount != taskCount/2 {
		t.Fatalf("unexpected error count: got %d want %d", errorCount, taskCount/2)
	}

	for i := 0; i < 2; i++ {
		select {
		case <-closeDone:
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for Close to return")
		}
	}
}

func TestWorkerPoolRejectsSubmissionsAfterClose(t *testing.T) {
	pool := NewWorkerPool(1, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool.Start(ctx, func(ctx context.Context, task Task) (TaskResult, error) {
		return TaskResult{}, nil
	})

	pool.Close()

	if ok := pool.Submit(Task{offset: 1}); ok {
		t.Fatal("expected submit after close to fail")
	}
}

// The source must not silently remain locked to Quark when the website switches drives.
func TestPanSearchRequestsDoNotForceQuark(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("pan") != "" {
			t.Errorf("unexpected forced drive: %s", r.URL.Query().Get("pan"))
		}
		if r.URL.Query().Get("keyword") != "Python" {
			t.Errorf("keyword missing: %s", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"pageProps":{"data":{"total":0,"data":[]}}}`)
	}))
	defer server.Close()
	p := &PanSearchAsyncPlugin{timeout: time.Second}
	if _, _, err := p.fetchFirstPage("Python", server.URL, server.Client()); err != nil {
		t.Fatal(err)
	}
	if _, err := p.fetchPage("Python", 10, server.URL, server.Client()); err != nil {
		t.Fatal(err)
	}
	for _, domain := range []string{"115cdn.com", "anxia.com"} {
		if normalizePanSearchType("", "https://"+domain+"/s/abc") != "115" {
			t.Fatal("115 alias missing")
		}
	}
	if normalizePanSearchType("", "https://guangyapan.com/s/abc") != "guangya" {
		t.Fatal("Guangya missing")
	}
}
