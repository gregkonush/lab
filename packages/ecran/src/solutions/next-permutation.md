```python
class Solution:
    def nextPermutation(self, nums: List[int]) -> None:
        """
        Do not return anything, modify nums in-place instead.
        """
        n = len(nums)
        i = n - 2
        # 1. find a first element that is not increasing from the end
        # e.g. 2, 1, 5, 4, 3, 0, 0, ~> index of 1 will be found i = 1
        while i >= 0 and nums[i] >= nums[i + 1]:
            i -= 1

        # 2. find a minimum element on the right side of an index to swap elements
        if i >= 0:
            j = n - 1
            while j > i and nums[j] <= nums[i]:
                j -= 1

            nums[i], nums[j] = nums[j], nums[i]
        # 3. swap elements on the right side of element
        left, right = i + 1, n - 1
        while left < right:
            nums[left], nums[right] = nums[right], nums[left]
            left += 1
            right -= 1
```
