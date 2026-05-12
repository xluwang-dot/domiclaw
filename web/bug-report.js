(function() {
  var html = '<button class="bug-btn" onclick="toggleBug()" title="Report Bug">\u{1F41B}</button>'
    + '<div class="bug-modal" id="bugModal" style="display:none" onclick="if(event.target===this)toggleBug()">'
    + '<div class="bug-dialog"><h3>\u{1F41B} 反馈</h3>'
    + '<select id="bugType" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #ccc;font-size:13px;margin-bottom:10px;outline:none">'
    + '<option value="bug">\u{1F41B} 上报 Bug</option>'
    + '<option value="idea">\u{1F4A1} 新增创意</option>'
    + '</select>'
    + '<input id="bugTitle" placeholder="标题" /><textarea id="bugDesc" placeholder="描述（可选）"></textarea>'
    + '<div class="bug-meta" id="bugMeta"></div>'
    + '<div class="bug-actions">'
    + '<button onclick="toggleBug()" style="padding:6px 14px;border-radius:6px;border:1px solid #ccc;background:#f5f5f5;cursor:pointer;font-size:13px">取消</button>'
    + '<button onclick="submitBug()" style="padding:6px 14px;border-radius:6px;border:none;background:#0a84ff;color:#fff;cursor:pointer;font-size:13px">提交</button>'
    + '</div></div></div>';
  document.body.insertAdjacentHTML("beforeend", html);

  window.toggleBug = function() {
    var m = document.getElementById("bugModal");
    m.style.display = m.style.display === "none" ? "flex" : "none";
    if (m.style.display === "flex") {
      document.getElementById("bugMeta").textContent =
        location.href + " | " + navigator.userAgent.substring(0, 80) + " | " + new Date().toISOString();
    }
  };

  window.submitBug = async function() {
    var t = document.getElementById("bugTitle").value.trim();
    if (!t) { alert("标题不能为空"); return; }
    var d = document.getElementById("bugDesc").value.trim();
    var p = document.getElementById("bugMeta").textContent;
    var tp = document.getElementById("bugType").value;
    var r = await fetch("/api/bug-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, description: d, page: p, type: tp }),
    });
    var j = await r.json();
    if (j.id) {
      alert(tp === "idea" ? "创意已提交！" : "Bug #" + j.id + " 已提交！");
      toggleBug();
      document.getElementById("bugTitle").value = "";
      document.getElementById("bugDesc").value = "";
    } else {
      alert("提交失败: " + (j.error || "unknown"));
    }
  };
})();
