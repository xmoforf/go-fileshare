package main

import (
	"strings"
	"testing"
)

func TestAccessibleUIContract(t *testing.T) {
	for _, s := range []string{
		`<button type="button" class="col-name" data-sort="name">`,
		`<button type="button" class="col-size" data-sort="size">`,
		`<button type="button" class="col-date" data-sort="date">`,
		`id="previousPage"`, `id="nextPage"`, `id="pageStatus" role="status"`,
		`id="customSeconds" type="number" min="1" max="315360000" step="1"`,
	} {
		if !strings.Contains(string(ui), s) {
			t.Errorf("UI missing native control: %s", s)
		}
	}
	for _, s := range []string{`function renderVisible()`, `customHours`, `scroll-spacer`} {
		if strings.Contains(string(ui), s) {
			t.Errorf("UI retains obsolete behavior: %s", s)
		}
	}
}

func TestShareUIContract(t *testing.T) {
	for _, s := range []string{`id="loginDialog"`, `id="shareDialog"`, `id="sharesDialog"`, `id="shareCurrent"`, `/api/list`, `/api/shares`, `/api/login`, `X-Requested-With`, `encodeURIComponent(item.name)`, `function renderPage()`, `function applyFilterAndSort()`} {
		if !strings.Contains(string(ui), s) {
			t.Errorf("UI missing %s", s)
		}
	}
	// Fanboy's Social Blocking List hides the generic .share-btn class.
	if strings.Contains(string(ui), "copy-btn share-btn") || !strings.Contains(string(ui), "copy-btn file-link-action") {
		t.Error("file action must not match the known social-sharing cosmetic filter")
	}
	if strings.Contains(string(ui), "fetch('_api/'") {
		t.Error("legacy API remains")
	}
}
