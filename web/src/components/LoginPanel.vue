<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/composables/useToast'

const emit = defineEmits<{ success: [] }>()

const auth = useAuthStore()

const phone = ref('')
const code = ref('')
const cooldown = ref(0)
const sending = ref(false)
const submitting = ref(false)
/**
 * 监护人同意。
 *
 * 刻意做成"必须主动勾选"，而不是"登录即表示同意"——后者在面向未成年人的产品里
 * 等于没有取得同意。勾选状态不记忆，每次打开登录层都从空开始：
 * 家长替孩子勾一次就永久生效，反而是最容易被质疑的地方。
 */
const agreed = ref(false)
/** 用户试着勾选前点了登录时给一句提示（按钮 disabled 时点不动，只能这样引导） */
const agreedHint = ref(false)
/** 开发模式下后端会回传验证码，这里记下来做提示 */
const mockCode = ref('')

let timer: ReturnType<typeof setInterval> | null = null

const phoneOk = computed(() => /^1[3-9]\d{9}$/.test(phone.value))
const codeOk = computed(() => /^\d{6}$/.test(code.value))
const canSubmit = computed(
  () => phoneOk.value && codeOk.value && agreed.value && !submitting.value,
)

function startCountdown(sec: number) {
  cooldown.value = sec
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

/** 只允许数字，避免手机键盘上误输入其他字符 */
function onPhoneInput(e: Event) {
  const el = e.target as HTMLInputElement
  phone.value = el.value.replace(/\D/g, '').slice(0, 11)
}

function onCodeInput(e: Event) {
  const el = e.target as HTMLInputElement
  code.value = el.value.replace(/\D/g, '').slice(0, 6)
}

async function onSend() {
  if (cooldown.value > 0 || sending.value || !phoneOk.value) return
  sending.value = true
  try {
    const r = await auth.sendCode(phone.value)
    startCountdown(r.cooldownSec)
    if (r.mockCode) {
      mockCode.value = r.mockCode
      code.value = r.mockCode
      toast.info(`开发模式：验证码 ${r.mockCode} 已自动填入`)
    } else {
      toast.ok('验证码已发送')
    }
  } catch (e) {
    toast.bad((e as Error).message)
  } finally {
    sending.value = false
  }
}

async function onSubmit() {
  if (!agreed.value) {
    agreedHint.value = true
    return
  }
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const u = await auth.login(phone.value, code.value, true)
    toast.ok(`欢迎回来，${u.nickname}`)
    emit('success')
  } catch (e) {
    toast.bad((e as Error).message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <p class="mb-4 text-sm text-ink-weak">
      用手机号登录，第一次登录会自动为你创建账号。登录后可以收藏词条、积累积分。
    </p>

    <form class="space-y-3" @submit.prevent="onSubmit">
      <div>
        <label for="login-phone" class="mb-1 block text-sm text-ink-weak">手机号</label>
        <input
          id="login-phone"
          :value="phone"
          class="input"
          type="tel"
          inputmode="numeric"
          autocomplete="tel"
          maxlength="11"
          placeholder="请输入 11 位手机号"
          @input="onPhoneInput"
        />
      </div>

      <div>
        <label for="login-code" class="mb-1 block text-sm text-ink-weak">验证码</label>
        <div class="flex gap-2">
          <input
            id="login-code"
            :value="code"
            class="input flex-1"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="6 位数字"
            @input="onCodeInput"
          />
          <button
            type="button"
            class="btn-ghost w-[7.5rem] shrink-0 text-sm"
            :disabled="cooldown > 0 || sending || !phoneOk"
            @click="onSend"
          >
            <span v-if="cooldown > 0">{{ cooldown }} 秒后重发</span>
            <span v-else-if="sending">发送中…</span>
            <span v-else>获取验证码</span>
          </button>
        </div>
      </div>

      <!--
        同意勾选放在登录按钮**上方**，而不是小字放在最底下：
        面向未成年人的产品，这个是必要条件，不该是页脚装饰。
        隐私页用新标签打开——不能把已经填好的手机号和验证码弄丢。
      -->
      <label class="flex cursor-pointer items-start gap-2 rounded-btn bg-bg/60 p-2 text-xs leading-5 text-ink-weak">
        <input
          v-model="agreed"
          type="checkbox"
          class="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          @change="agreedHint = false"
        />
        <span>
          我已阅读并同意
          <a
            href="/privacy"
            target="_blank"
            rel="noopener"
            class="text-primary hover:underline"
            @click.stop
          >《隐私说明》</a>，并由监护人同意孩子使用本产品
        </span>
      </label>
      <p v-if="agreedHint && !agreed" class="-mt-1 text-xs text-bad">请先勾选同意，再登录</p>

      <button
        type="submit"
        class="btn-primary w-full"
        :disabled="!phoneOk || !codeOk || submitting"
      >
        {{ submitting ? '登录中…' : '登录' }}
      </button>
    </form>

    <p v-if="mockCode" class="mt-3 rounded-btn bg-primary-soft px-3 py-2 text-xs text-primary-deep">
      开发模式：短信未真实发送，验证码固定为 {{ mockCode }}
    </p>

    <div class="my-4 flex items-center gap-3 text-xs text-ink-weak">
      <span class="h-px flex-1 bg-line" />
      其他方式
      <span class="h-px flex-1 bg-line" />
    </div>

    <button
      type="button"
      class="btn-ghost w-full text-sm opacity-60"
      disabled
      title="需要企业主体资质与网站备案，个人开发者暂无法申请"
    >
      微信登录（即将开放）
    </button>

    <p class="mt-4 text-center text-xs leading-5 text-ink-weak">
      未满 14 周岁的同学请在家长陪同下使用<br />
      我们用手机号识别账号，不会向你发送任何推广信息
    </p>
  </div>
</template>
