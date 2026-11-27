<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
</script>

<!--
  隐私说明。
  面向未成年人收集手机号，这一页是答辩必问项，也是"能上线"的前提。
  写法上刻意做到三件事：
  1. 按「收集什么 / 做什么用 / 存多久 / 谁能看 / 你有什么权利」分块，不用法律黑话；
  2. 每条都写具体字段名，不写"相关信息"这种含糊表述；
  3. 明确留一个"找我们删除"的出口——没有删除路径的隐私说明等于没写。
-->
<template>
  <div class="md:mx-auto md:max-w-2xl">
    <PageHeader title="隐私说明" back-to="/" />

    <AppCard>
      <p class="text-sm leading-6 text-ink-weak">
        雅言小筑是一个帮助小学生辨别网络用语、积累书面表达的学习工具。为了让你和家长放心，
        下面把我们收集什么、怎么用、存多久，一条条写清楚。
        最后更新：2026 年 11 月。
      </p>

      <div class="mt-5 space-y-5 text-sm leading-6">
        <section>
          <h2 class="text-base font-semibold text-ink">一、我们收集哪些信息</h2>
          <ul class="mt-2 space-y-1.5 text-ink-weak">
            <li>
              <strong class="text-ink">手机号</strong>：仅用于接收登录验证码、识别你的账号。
              我们不收集姓名、身份证号、头像、学校、年级。
            </li>
            <li>
              <strong class="text-ink">学习记录</strong>：打开过哪些词条、展开过哪些雅词、
              收藏了哪些内容、情景挑战的答对情况与用时。这些数据用来计算积分、解锁徽章、
              生成给家长看的学习小结。
            </li>
            <li>
              <strong class="text-ink">登录时间</strong>：记录你同意本说明的时间，以及每天是否有学习记录
              （用于连续打卡）。
            </li>
            <li>
              <strong class="text-ink">语言测评写的内容</strong>：你在测评页写的那段话，会临时发送给
              为我们提供 AI 分析能力的模型服务商，仅用于生成这次的四维评价。
              <strong class="text-ink">本站服务器不保存原文</strong>，结果只留在你自己的浏览器里，
              换设备或清除浏览器数据后就看不到了。
            </li>
            <li>
              <strong class="text-ink">我们不收集</strong>：位置、通讯录、相册、设备通讯记录、
              其它 App 的使用情况，也不使用第三方广告或统计 SDK。
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-base font-semibold text-ink">二、这些信息用来做什么</h2>
          <ul class="mt-2 space-y-1.5 text-ink-weak">
            <li>让你用手机号 + 验证码登录，并在换设备后继续看到自己的进度。</li>
            <li>计算积分、连续打卡天数、徽章，让学习有反馈。</li>
            <li>生成"学习小结"图片给家长看（这张图只在你点击【保存为图片】时才生成，不会自动发给任何人）。</li>
            <li>统计班级或年级的整体使用情况时，只使用去掉手机号后的汇总数字。</li>
          </ul>
        </section>

        <section>
          <h2 class="text-base font-semibold text-ink">三、我们不会做什么</h2>
          <ul class="mt-2 space-y-1.5 text-ink-weak">
            <li>
              不向任何第三方出售、出租或共享你的手机号与学习记录。
              <strong class="text-ink">只有一个例外</strong>：使用「家校反馈」的 AI 小结和「语言测评」时，
              会向模型服务商发送去掉手机号后的汇总数字（小结），或你写的那段文字（测评），
              仅用于当场生成内容。这不是出售或共享，也不附带任何能识别你身份的信息。
            </li>
            <li>不发送营销短信、不做广告推送、不做用户画像投放。</li>
            <li>不会把学习记录公开给其他用户看到。</li>
          </ul>
        </section>

        <section>
          <h2 class="text-base font-semibold text-ink">四、保存多久、存在哪里</h2>
          <ul class="mt-2 space-y-1.5 text-ink-weak">
            <li>
              数据保存在我们自己管理的服务器上，不放在第三方网盘或公开的数据库里。
              语言测评的原文不会被保存到硬盘或数据库，只在你提交的那一次请求中存在。
            </li>
            <li>账号存续期间保留；你要求删除后，我们会在 7 个工作日内清除账号与学习记录。</li>
            <li>验证码 5 分钟内有效，过期即失效，不长期保存。</li>
          </ul>
        </section>

        <section>
          <h2 class="text-base font-semibold text-ink">五、监护人须知与同意</h2>
          <ul class="mt-2 space-y-1.5 text-ink-weak">
            <li>
              本产品面向小学生（未满 14 周岁）。<strong class="text-ink">首次登录前需要监护人阅读本说明并同意</strong>，
              登录页有明确的勾选项，不勾选无法登录。
            </li>
            <li>同意后我们会记录同意时间，作为已取得同意的凭证。</li>
            <li>如果监护人不同意，请不要勾选，也不要继续登录；此时不会收集任何信息。</li>
            <li>监护人可随时要求查看、更正或删除孩子的数据，方式见下一条。</li>
          </ul>
        </section>

        <section>
          <h2 class="text-base font-semibold text-ink">六、你的权利与联系方式</h2>
          <p class="mt-2 text-ink-weak">
            你或家长可以随时要求：查看我们保存了哪些数据、更正错误信息、删除账号与全部学习记录。
            通过登录页的手机号联系我们，或发送邮件至
            <span class="whitespace-nowrap font-medium text-ink">privacy@yayanxiaozhu.example</span>，
            我们会在 7 个工作日内处理。
          </p>
          <p class="mt-2 text-ink-weak">
            如果对本说明有疑问，也欢迎先联系我们，我们会把具体字段和使用方式再解释一遍。
          </p>
        </section>
      </div>

      <p class="mt-5 rounded-btn bg-primary-soft px-3 py-2 text-xs leading-5 text-ink-weak">
        说明：本项目为大学生创新创业训练计划项目，暂无商业运营，也未接入任何广告或数据服务商。
        本页内容会随功能变化更新，重要变更会在首页提示。
      </p>

      <RouterLink to="/" class="btn-ghost mt-4 w-full text-sm">返回首页</RouterLink>
    </AppCard>
  </div>
</template>
