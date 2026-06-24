import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Field,
  FieldDescription,
  FieldError,
  Input,
  PasswordField,
  Textarea,
  TextareaField,
  TextField,
} from './index';

// Field 家族契约（Field 规范 §3/§4/§5/§6/§7/§8/§9）：
// Label/Control/Support 顺序固定并以稳定 ID 关联；Error 替换 Description
// 并置 aria-invalid；“可选”只由 isOptional 渲染，isRequired 走原生 required
// 不加星号；Clear 只在启用且有值的 isClearable 短字段出现且清后保焦点；
// PasswordField 切 type 不动 value/caret/focus；Input/Select 44px、输入文字
// 16px、Textarea resize-none 且最小 112px；readonly 可焦点可复制、disabled
// 退出 Tab 序；Autofill 映射回 --field-bg；type/inputMode/autoComplete/
// enterKeyHint 直达原生 input。

describe('Field 基础层关联', () => {
  it('Label、Description 与控件通过稳定 ID 关联，rerender 后 ID 不变', () => {
    const { rerender } = render(
      <Field
        label="链名称"
        description="家人会在时间线上看到这个名字"
        isOptional
      >
        <Input name="chain-name" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: '链名称' });
    const label = screen.getByText('链名称');
    expect(input.id).toBeTruthy();
    expect(label).toHaveAttribute('for', input.id);
    const description = screen.getByText('家人会在时间线上看到这个名字');
    expect(description.id).toBeTruthy();
    expect(input).toHaveAttribute('aria-describedby', description.id);
    // “可选”只由 isOptional 渲染，位于 Label 行
    expect(screen.getByText('可选')).toBeInTheDocument();

    const stableId = input.id;
    const stableDescribedBy = input.getAttribute('aria-describedby');
    rerender(
      <Field
        label="链名称"
        description="家人会在时间线上看到这个名字"
        isOptional
      >
        <Input name="chain-name" />
      </Field>,
    );
    const again = screen.getByRole('textbox', { name: '链名称' });
    expect(again.id).toBe(stableId);
    expect(again).toHaveAttribute('aria-describedby', stableDescribedBy);
  });

  it('isOptional 缺省时不渲染“可选”', () => {
    render(
      <Field label="链名称">
        <Input name="chain-name" />
      </Field>,
    );
    expect(screen.queryByText('可选')).toBeNull();
  });

  it('Error 替换 Description，置 aria-invalid 并进入 aria-describedby', () => {
    render(
      <Field
        label="链名称"
        description="家人会在时间线上看到这个名字"
        isInvalid
        errorMessage="请输入链名称"
      >
        <Input name="chain-name" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: '链名称' });
    expect(screen.queryByText('家人会在时间线上看到这个名字')).toBeNull();
    const error = screen.getByText('请输入链名称');
    expect(error.id).toBeTruthy();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('公开的 FieldDescription / FieldError 可在 Field 内手动组合并保持关联', () => {
    const { rerender } = render(
      <Field label="简介">
        <Textarea name="bio" />
        <FieldDescription>会显示在链资料页</FieldDescription>
      </Field>,
    );
    const textarea = screen.getByRole('textbox', { name: '简介' });
    const description = screen.getByText('会显示在链资料页');
    expect(description.id).toBeTruthy();
    expect(textarea).toHaveAttribute('aria-describedby', description.id);

    rerender(
      <Field label="简介" isInvalid>
        <Textarea name="bio" />
        <FieldError>请补充一句话介绍</FieldError>
      </Field>,
    );
    expect(screen.queryByText('会显示在链资料页')).toBeNull();
    const error = screen.getByText('请补充一句话介绍');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-describedby', error.id);
  });
});

describe('TextField', () => {
  it('isRequired 落到原生 required 语义，不渲染星号', () => {
    render(
      <TextField label="链名称" name="name" isRequired value="" onChange={() => {}} />,
    );
    expect(screen.getByRole('textbox', { name: '链名称' })).toBeRequired();
    expect(screen.queryByText('*')).toBeNull();
  });

  it('type/inputMode/autoComplete/enterKeyHint/name 直达原生 input', () => {
    render(
      <TextField
        label="邮箱"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        enterKeyHint="go"
        value=""
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole('textbox', { name: '邮箱' });
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('inputmode', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(input).toHaveAttribute('enterkeyhint', 'go');
    expect(input).toHaveAttribute('name', 'email');
  });

  it('onChange 以字符串值回传', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="昵称" name="nick" defaultValue="" onChange={onChange} />);
    await user.type(screen.getByRole('textbox', { name: '昵称' }), 'ab');
    expect(onChange).toHaveBeenLastCalledWith('ab');
  });

  it('控件高 44px、输入文字 16px', () => {
    render(<TextField label="昵称" name="nick" value="" onChange={() => {}} />);
    const input = screen.getByRole('textbox', { name: '昵称' });
    expect(input.className).toContain('h-field');
    expect(input.className).toContain('var(--field-text-size)');
  });

  it('Autofill 状态映射回 --field-bg，不残留浏览器底色', () => {
    render(<TextField label="邮箱" name="email" value="" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: '邮箱' }).className).toMatch(
      /autofill:[^\s]*var\(--field-bg\)/,
    );
  });

  it('readonly 可聚焦可选择复制，disabled 退出 Tab 序', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TextField
          label="邀请链接"
          name="invite-url"
          value="https://example.com/invite"
          onChange={() => {}}
          readOnly
        />
        <TextField
          label="旧字段"
          name="legacy"
          value="不可改"
          onChange={() => {}}
          disabled
        />
        <TextField label="昵称" name="nick" value="" onChange={() => {}} />
      </>,
    );
    const readonly = screen.getByRole('textbox', {
      name: '邀请链接',
    }) as HTMLInputElement;
    expect(readonly).toHaveAttribute('readonly');
    expect(readonly).not.toBeDisabled();
    readonly.focus();
    expect(readonly).toHaveFocus();
    readonly.select();
    expect(readonly.selectionStart).toBe(0);
    expect(readonly.selectionEnd).toBe('https://example.com/invite'.length);

    expect(screen.getByLabelText('旧字段')).toBeDisabled();
    // 从 readonly 出发按 Tab：disabled 字段被跳过，直接落到下一个可用字段
    await user.tab();
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveFocus();
  });
});

describe('Clear 尾动作', () => {
  function Harness({
    initial = '',
    isClearable = true,
    disabled = false,
    readOnly = false,
  }: {
    initial?: string;
    isClearable?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <TextField
        label="搜索"
        name="q"
        isClearable={isClearable}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        onChange={setValue}
      />
    );
  }

  it('空值、未开启 isClearable、disabled、readOnly 时都不出现', () => {
    const { rerender } = render(<Harness initial="" />);
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
    rerender(<Harness initial="abc" isClearable={false} />);
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
    rerender(<Harness initial="abc" disabled />);
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
    rerender(<Harness initial="abc" readOnly />);
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
  });

  it('启用且有值时出现；清空后焦点保留在输入框，按钮消失', async () => {
    const user = userEvent.setup();
    render(<Harness initial="abc" />);
    const input = screen.getByRole('textbox', { name: '搜索' });
    input.focus();
    const clear = screen.getByRole('button', { name: '清除' });
    expect(clear).toHaveAttribute('type', 'button');

    await user.click(clear);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
  });
});

describe('PasswordField', () => {
  function Harness() {
    const [value, setValue] = useState('secret-123');
    return (
      <PasswordField
        label="密码"
        name="password"
        autoComplete="current-password"
        value={value}
        onChange={setValue}
      />
    );
  }

  it('切换显示不改变 value、光标与焦点，可访问名称随状态变化', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('密码') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    input.focus();
    input.setSelectionRange(2, 5);

    await user.click(screen.getByRole('button', { name: '显示密码' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('secret-123');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
    expect(input).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '隐藏密码' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('secret-123');
    expect(input).toHaveFocus();
  });
});

describe('TextareaField', () => {
  it('resize-none、16px 文字、112px 最小高度', () => {
    render(<TextareaField label="一句话" name="bio" value="" onChange={() => {}} />);
    const textarea = screen.getByRole('textbox', { name: '一句话' });
    expect(textarea.className).toContain('resize-none');
    expect(textarea.className).toContain('min-h-textarea');
    expect(textarea.className).toContain('var(--field-text-size)');
  });

  it('minRows 映射原生 rows，maxLength 直达', () => {
    render(
      <TextareaField
        label="一句话"
        name="bio"
        minRows={4}
        maxLength={120}
        value=""
        onChange={() => {}}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: '一句话' });
    expect(textarea).toHaveAttribute('rows', '4');
    expect(textarea).toHaveAttribute('maxlength', '120');
  });
});
