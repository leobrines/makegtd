/* Shared date/time picker dialog. All user-facing strings are Spanish.
   One month grid at a time, optional time behind progressive disclosure
   ("Establecer hora"), Cancelar/Listo footer. Deliberately no repeat option:
   recurrence is out of scope for the picker. Markup shell lives in index.html
   (#datepicker-overlay); the body is rendered here on every state change. */
(function (global, $) {
  'use strict';

  var model = global.GTD.model;

  // State of the open dialog; null while closed.
  var state = null;

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function iso(year, month, day) {
    return year + '-' + pad(month + 1) + '-' + pad(day);
  }

  function monthTitle(year, month) {
    var text = new Date(year, month, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function render() {
    var year = state.year;
    var month = state.month;
    var today = model.todayISO();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    // Sunday-first grid; getDay() of the 1st is the number of leading blanks.
    var offset = new Date(year, month, 1).getDay();

    var html =
      '<div class="flex items-center justify-between mb-1">' +
      '<button type="button" class="btn-ghost" data-dp="prev" aria-label="Mes anterior">‹</button>' +
      '<span class="font-medium" aria-live="polite">' + monthTitle(year, month) + '</span>' +
      '<button type="button" class="btn-ghost" data-dp="next" aria-label="Mes siguiente">›</button>' +
      '</div>';

    html += '<div class="grid grid-cols-7 place-items-center text-xs text-stone-400 dark:text-stone-500" aria-hidden="true">';
    ['D', 'L', 'M', 'M', 'J', 'V', 'S'].forEach(function (letter) {
      html += '<span class="w-11 h-8 flex items-center justify-center">' + letter + '</span>';
    });
    html += '</div>';

    html += '<div class="grid grid-cols-7 place-items-center">';
    for (var blank = 0; blank < offset; blank++) html += '<span class="w-11 h-11"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var date = iso(year, month, day);
      var disabled = state.minDate && date < state.minDate;
      var cls = 'w-11 h-11 rounded-full text-sm flex items-center justify-center transition-colors duration-150';
      if (date === state.date) {
        cls += ' bg-accent text-white font-medium';
      } else if (disabled) {
        cls += ' text-stone-300 dark:text-stone-700';
      } else {
        cls += ' hover:bg-stone-100 dark:hover:bg-stone-800';
        if (date === today) cls += ' text-accent font-semibold';
      }
      html +=
        '<button type="button" class="' + cls + '" data-dp-day="' + date + '"' +
        (disabled ? ' disabled' : '') +
        (date === state.date ? ' aria-pressed="true"' : '') +
        '>' + day + '</button>';
    }
    html += '</div>';

    if (state.allowTime) {
      html += '<div class="border-t border-stone-100 dark:border-stone-800 mt-3 pt-1">';
      if (state.timeOpen) {
        html +=
          '<div class="flex items-center gap-2 py-1">' +
          '<span aria-hidden="true">🕐</span>' +
          '<input type="time" id="dp-time" class="field flex-1" value="' + (state.time || '') + '" aria-label="Hora" />' +
          '<button type="button" class="btn-ghost shrink-0" data-dp="clear-time">Quitar</button>' +
          '</div>';
      } else {
        html +=
          '<button type="button" class="btn-ghost w-full justify-start gap-3" data-dp="set-time">' +
          '<span aria-hidden="true">🕐</span>Establecer hora</button>';
      }
      html += '</div>';
    }

    html +=
      '<div class="flex items-center justify-end gap-2 mt-1">' +
      '<button type="button" class="btn-ghost text-accent" data-dp="cancel">Cancelar</button>' +
      '<button type="button" class="btn-ghost text-accent font-medium" data-dp="done">Listo</button>' +
      '</div>';

    $('#datepicker-panel').html(html);
  }

  // opts: {date, time, minDate, allowTime, onDone(dateISO, timeOrNull)}.
  // A selection always exists (today by default, clamped to minDate), so
  // Listo always confirms a date; clearing is the caller's affair.
  function open(opts) {
    opts = opts || {};
    var initial = opts.date || model.todayISO();
    if (opts.minDate && initial < opts.minDate) initial = opts.minDate;
    var parts = initial.split('-');
    state = {
      date: initial,
      time: opts.time || null,
      timeOpen: !!opts.time,
      allowTime: opts.allowTime !== false && model.timeFieldEnabled(),
      minDate: opts.minDate || null,
      year: Number(parts[0]),
      month: Number(parts[1]) - 1,
      onDone: opts.onDone || null,
    };
    render();
    $('#datepicker-overlay').removeClass('hidden').attr('aria-hidden', 'false');
  }

  function close() {
    state = null;
    $('#datepicker-overlay').addClass('hidden').attr('aria-hidden', 'true');
  }

  // The time input is rebuilt on every render: pull its value into the state
  // before anything re-renders or confirms.
  function readTime() {
    var $time = $('#dp-time');
    if (state && state.timeOpen && $time.length) state.time = $time.val() || null;
  }

  function bind() {
    var $panel = $('#datepicker-panel');

    $panel.on('click', '[data-dp="prev"], [data-dp="next"]', function () {
      readTime();
      var moved = new Date(state.year, state.month + ($(this).data('dp') === 'prev' ? -1 : 1), 1);
      state.year = moved.getFullYear();
      state.month = moved.getMonth();
      render();
    });

    $panel.on('click', '[data-dp-day]', function () {
      readTime();
      state.date = $(this).data('dp-day');
      render();
    });

    $panel.on('click', '[data-dp="set-time"]', function () {
      state.timeOpen = true;
      render();
      $('#dp-time').trigger('focus');
    });

    $panel.on('click', '[data-dp="clear-time"]', function () {
      state.time = null;
      state.timeOpen = false;
      render();
    });

    $panel.on('change', '#dp-time', readTime);

    $panel.on('click', '[data-dp="cancel"]', close);

    $panel.on('click', '[data-dp="done"]', function () {
      readTime();
      var onDone = state.onDone;
      var date = state.date;
      var time = state.time;
      close();
      if (onDone) onDone(date, time);
    });

    $('#datepicker-overlay').on('click', function (e) {
      if (e.target === this) close();
    });

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape' && state) close();
    });
  }

  $(bind);

  global.GTD.datepicker = {
    open: open,
    close: close,
  };
})(window, jQuery);
