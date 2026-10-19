;(function () {
  'use strict'

  var html = document.documentElement

  /* ---------- 主题切换 ---------- */
  function applyTheme(theme) {
    html.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('theme', theme)
    } catch (e) {}
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false')
    })
  }

  function initTheme() {
    var saved = null
    try {
      saved = localStorage.getItem('theme')
    } catch (e) {}
    if (!saved) {
      saved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    applyTheme(saved)

    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')
      })
    })

    // 用户未手动选择时，跟随系统变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      var manual = null
      try {
        manual = localStorage.getItem('theme')
      } catch (err) {}
      if (!manual) applyTheme(e.matches ? 'dark' : 'light')
    })
  }

  /* ---------- 语言下拉 ---------- */
  function initLangSwitch() {
    document.querySelectorAll('[data-lang-switch]').forEach(function (root) {
      var trigger = root.querySelector('.lang-switch__trigger')
      if (!trigger) return

      function close() {
        root.setAttribute('data-open', 'false')
        trigger.setAttribute('aria-expanded', 'false')
        trigger.setAttribute('aria-pressed', 'false')
      }
      function open() {
        root.setAttribute('data-open', 'true')
        trigger.setAttribute('aria-expanded', 'true')
        trigger.setAttribute('aria-pressed', 'true')
      }

      trigger.addEventListener('click', function (e) {
        e.stopPropagation()
        root.getAttribute('data-open') === 'true' ? close() : open()
      })

      // 初始状态与 aria-expanded 保持一致，避免读屏读到的按下态是空的
      close()

      document.addEventListener('click', function (e) {
        if (!root.contains(e.target)) close()
      })

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return
        // 只在菜单开着且焦点还在组件内时处理，避免抢走页面上其它 Esc 行为
        if (root.getAttribute('data-open') !== 'true') return
        if (!root.contains(document.activeElement)) return
        close()
        trigger.focus()
      })
    })
  }

  /* ---------- 目录高亮当前章节 ---------- */
  function initTocHighlight() {
    var toc = document.querySelector('[data-toc]')
    if (!toc) return

    var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'))
    var headings = links
      .map(function (a) {
        var id = decodeURIComponent(a.getAttribute('href').slice(1))
        return document.getElementById(id)
      })
      .filter(Boolean)

    if (!headings.length) return

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          var id = entry.target.id
          links.forEach(function (a) {
            var active = a.getAttribute('href') === '#' + id
            a.classList.toggle('is-active', active)
          })
        })
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    )

    headings.forEach(function (h) {
      observer.observe(h)
    })
  }

  /* ---------- 阅读进度条 ---------- */
  function initReadingProgress() {
    var bar = document.querySelector('[data-reading-progress]')
    if (!bar) return
    var article = document.querySelector('[data-article-body]')
    if (!article) return

    function update() {
      var rect = article.getBoundingClientRect()
      var total = rect.height - window.innerHeight
      var progress = total > 0 ? (0 - rect.top) / total : 1
      progress = Math.min(1, Math.max(0, progress))
      bar.style.transform = 'scaleX(' + progress + ')'
    }

    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
  }

  /* ---------- 代码块复制按钮 ---------- */
  function initCodeCopy() {
    document.querySelectorAll('.prose pre').forEach(function (pre) {
      var btn = document.createElement('button')
      btn.className = 'code-copy'
      btn.type = 'button'
      btn.textContent = 'Copy'
      btn.addEventListener('click', function () {
        var code = pre.querySelector('code')
        var text = code ? code.innerText : pre.innerText
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = 'Copied'
          btn.classList.add('is-copied')
          setTimeout(function () {
            btn.textContent = 'Copy'
            btn.classList.remove('is-copied')
          }, 1600)
        })
      })
      pre.appendChild(btn)
    })
  }

  function init() {
    initTheme()
    initLangSwitch()
    initTocHighlight()
    initReadingProgress()
    initCodeCopy()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
