export function calculate_budget(totalBudget, items) {
  if (!Number.isSafeInteger(totalBudget) || totalBudget < 0 || !Array.isArray(items)) {
    throw new TypeError('총예산은 0 이상의 정수 원화 금액이어야 하며, 비용 항목은 배열이어야 합니다.');
  }

  let confirmedTotal = 0;
  let estimatedTotal = 0;
  let unknownCount = 0;
  const expenses = items.map(item => {
    const { category, amount, status } = item ?? {};
    if (typeof category !== 'string' || !category.trim()) throw new TypeError('비용 항목 이름이 필요합니다.');
    if (status === 'unknown' && amount == null) {
      unknownCount++;
      return { category, amount: null, status };
    }
    if (!['confirmed', 'estimated'].includes(status) || !Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError('확인된 가격과 추정치는 0 이상의 정수 원화 금액이어야 합니다.');
    }
    if (status === 'confirmed') confirmedTotal += amount;
    else estimatedTotal += amount;
    return { category, amount, status };
  });

  const totalCost = confirmedTotal + estimatedTotal;
  if (!Number.isSafeInteger(totalCost)) throw new RangeError('비용 합계가 안전한 정수 범위를 초과했습니다.');
  return {
    totalBudget, expenses, confirmedTotal, estimatedTotal, unknownCount, totalCost,
    remainingBudget: totalBudget - totalCost,
    isProvisional: unknownCount > 0 || expenses.some(item => item.status === 'estimated'),
  };
}
